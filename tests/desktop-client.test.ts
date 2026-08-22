import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { CodexDesktopClient } from "../src/codex/desktop-client";

type Router = {
  close: () => Promise<void>;
  home: string;
  select: (threadId: string) => void;
  updateCount: () => number;
};

const THREAD_A = "01a0289e-e3d3-7fc1-8774-bbc3bc4f0712";
const THREAD_B = "01a0289e-e3d3-7fc1-8774-bbc3bc4f0713";
const cleanups: Array<() => Promise<void>> = [];

function frame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
}

async function fakeRouter(): Promise<Router> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-streamdeck-"));
  const ipc = path.join(home, "ipc");
  const socketPath = path.join(ipc, "ipc.sock");
  fs.mkdirSync(ipc);

  const database = new DatabaseSync(path.join(home, "state_5.sqlite"));
  database.exec(
    "CREATE TABLE threads (id TEXT PRIMARY KEY, model TEXT, reasoning_effort TEXT)",
  );
  const insert = database.prepare("INSERT INTO threads VALUES (?, ?, ?)");
  insert.run(THREAD_A, "gpt-5.6-sol", "medium");
  insert.run(THREAD_B, "gpt-5.6-terra", "high");

  let selected = THREAD_A;
  let updates = 0;
  let activeSocket: net.Socket | undefined;
  const server = net.createServer((socket) => {
    activeSocket = socket;
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0);
        if (buffer.length < length + 4) return;
        const request = JSON.parse(
          buffer.subarray(4, length + 4).toString("utf8"),
        ) as {
          method: string;
          params?: { conversationId?: string; threadSettings?: unknown };
          requestId: string;
        };
        buffer = buffer.subarray(length + 4);
        if (request.method === "initialize") {
          socket.write(
            frame({
              requestId: request.requestId,
              result: { clientId: crypto.randomUUID() },
              resultType: "success",
              type: "response",
            }),
          );
          socket.write(
            frame({
              method: "thread-stream-following-changed",
              params: { conversationId: selected, following: true },
              version: 1,
            }),
          );
        } else if (
          request.method === "thread-follower-update-thread-settings"
        ) {
          updates += 1;
          const settings = request.params?.threadSettings as {
            effort: string;
            model: string;
          };
          database
            .prepare(
              "UPDATE threads SET model = ?, reasoning_effort = ? WHERE id = ?",
            )
            .run(
              settings.model,
              settings.effort,
              request.params?.conversationId ?? "",
            );
          socket.write(
            frame({
              requestId: request.requestId,
              result: { ok: true },
              resultType: "success",
              type: "response",
            }),
          );
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  fs.chmodSync(socketPath, 0o600);

  const select = (threadId: string) => {
    const previous = selected;
    selected = threadId;
    activeSocket?.write(
      Buffer.concat([
        frame({
          method: "thread-stream-following-changed",
          params: { conversationId: previous, following: false },
          version: 1,
        }),
        frame({
          method: "thread-stream-following-changed",
          params: { conversationId: selected, following: true },
          version: 1,
        }),
      ]),
    );
  };
  const close = async () => {
    activeSocket?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
    fs.rmSync(home, { force: true, recursive: true });
  };
  cleanups.push(close);
  return { close, home, select, updateCount: () => updates };
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("Codex desktop client", () => {
  it("reads, updates, and verifies the selected local task", async () => {
    const router = await fakeRouter();
    const client = new CodexDesktopClient(router.home);
    const before = await client.readState();
    expect(before).toEqual({
      effort: "medium",
      model: "gpt-5.6-sol",
      threadId: THREAD_A,
    });

    const after = await client.update("gpt-5.6-luna", "high", THREAD_A);
    expect(after).toEqual({
      effort: "high",
      model: "gpt-5.6-luna",
      threadId: THREAD_A,
    });
    expect(router.updateCount()).toBe(1);
    client.disconnect();
  });

  it("does not apply a target computed for a task that is no longer selected", async () => {
    const router = await fakeRouter();
    const client = new CodexDesktopClient(router.home);
    await client.readState();
    router.select(THREAD_B);
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(
      client.update("gpt-5.6-luna", "medium", THREAD_A),
    ).rejects.toThrow("changed before the update");
    expect(router.updateCount()).toBe(0);
    client.disconnect();
  });
});
