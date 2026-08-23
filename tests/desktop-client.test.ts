import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { CodexDesktopClient } from "../src/codex/desktop-client";

type Router = {
  announce: (
    threadId: string,
    following: boolean,
    sourceClientId?: string,
    targeted?: boolean,
  ) => void;
  close: () => Promise<void>;
  home: string;
  select: (threadId: string) => void;
  setState: (threadId: string, model: string, effort: string) => void;
  snapshot: (
    threadId: string,
    options?: {
      effort?: string;
      model?: string;
      parentThreadId?: string;
      sideConversation?: boolean;
    },
  ) => void;
  updateCount: () => number;
};

type RemoteRouter = {
  close: () => Promise<void>;
  home: string;
  setStoredState: (model: string, effort: string) => void;
  setState: (model: string, effort: string) => void;
  statusRequestCount: () => number;
  updateTargets: () => Array<string | undefined>;
};

const THREAD_A = "01a0289e-e3d3-7fc1-8774-bbc3bc4f0712";
const THREAD_B = "01a0289e-e3d3-7fc1-8774-bbc3bc4f0713";
const THREAD_C = "01a0289e-e3d3-7fc1-8774-bbc3bc4f0714";
const cleanups: Array<() => Promise<void>> = [];

function frame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
}

async function fakeRouter(selectionDelayMs = 0): Promise<Router> {
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
          sourceClientId?: string;
          type?: string;
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
          const sendSelection = () =>
            socket.write(
              frame({
                method: "thread-stream-following-changed",
                params: {
                  conversationId: selected,
                  following: true,
                  hostId: "local",
                },
                sourceClientId: "desktop-ui-client",
                version: 1,
              }),
            );
          if (selectionDelayMs > 0) setTimeout(sendSelection, selectionDelayMs);
          else if (selectionDelayMs === 0) sendSelection();
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
        } else if (
          request.method === "thread-stream-following-changed" &&
          request.type === "broadcast"
        ) {
          socket.write(frame({ ...request, version: 1 }));
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
          params: {
            conversationId: previous,
            following: false,
            hostId: "local",
          },
          sourceClientId: "desktop-ui-client",
          version: 1,
        }),
        frame({
          method: "thread-stream-following-changed",
          params: {
            conversationId: selected,
            following: true,
            hostId: "local",
          },
          sourceClientId: "desktop-ui-client",
          version: 1,
        }),
      ]),
    );
  };
  const announce = (
    threadId: string,
    following: boolean,
    sourceClientId = "desktop-ui-client",
    targeted = false,
  ) => {
    activeSocket?.write(
      frame({
        method: "thread-stream-following-changed",
        params: { conversationId: threadId, following, hostId: "local" },
        sourceClientId,
        targetClientIds: targeted ? ["stream-deck-client"] : undefined,
        version: 1,
      }),
    );
  };
  const snapshot = (
    threadId: string,
    options: {
      effort?: string;
      model?: string;
      parentThreadId?: string;
      sideConversation?: boolean;
    } = {},
  ) => {
    const row = database
      .prepare("SELECT model, reasoning_effort FROM threads WHERE id = ?")
      .get(threadId) as { model: string; reasoning_effort: string };
    activeSocket?.write(
      frame({
        method: "thread-stream-state-changed",
        params: {
          change: {
            conversationState: {
              latestModel: options.model ?? row?.model,
              latestReasoningEffort: options.effort ?? row?.reasoning_effort,
              sideConversation: options.sideConversation ?? false,
              sideConversationParentNavigationPath: options.parentThreadId
                ? `/local/${options.parentThreadId}`
                : undefined,
            },
            type: "snapshot",
          },
          conversationId: threadId,
          hostId: "local",
        },
        sourceClientId: "desktop-ui-client",
        type: "broadcast",
        version: 11,
      }),
    );
  };
  const close = async () => {
    activeSocket?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
    fs.rmSync(home, { force: true, recursive: true });
  };
  cleanups.push(close);
  return {
    announce,
    close,
    home,
    select,
    setState: (threadId, model, effort) => {
      database
        .prepare(
          "UPDATE threads SET model = ?, reasoning_effort = ? WHERE id = ?",
        )
        .run(model, effort, threadId);
    },
    snapshot,
    updateCount: () => updates,
  };
}

async function fakeRemoteRouter(): Promise<RemoteRouter> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-streamdeck-"));
  const ipc = path.join(home, "ipc");
  const socketPath = path.join(ipc, "ipc.sock");
  fs.mkdirSync(ipc);
  const database = new DatabaseSync(path.join(home, "state_5.sqlite"));
  database.exec(
    "CREATE TABLE threads (id TEXT PRIMARY KEY, model TEXT, reasoning_effort TEXT)",
  );

  const relayClientId = "desktop-ui-client";
  const hostId = "remote-ssh-discovered:dev";
  let model = "gpt-5.6-luna";
  let effort = "high";
  let statusRequests = 0;
  const targets: Array<string | undefined> = [];
  let activeSocket: net.Socket | undefined;

  const sendSelection = (socket: net.Socket) => {
    socket.write(
      frame({
        method: "thread-stream-following-changed",
        params: { conversationId: THREAD_A, following: true, hostId },
        sourceClientId: "desktop-ui-client",
        type: "broadcast",
        version: 1,
      }),
    );
  };
  const sendSnapshot = (socket: net.Socket) => {
    socket.write(
      frame({
        method: "thread-stream-state-changed",
        params: {
          change: {
            conversationState: {
              latestModel: model,
              latestReasoningEffort: null,
              latestThreadSettings: { effort, model },
            },
            type: "snapshot",
          },
          conversationId: THREAD_A,
          hostId,
        },
        sourceClientId: relayClientId,
        type: "broadcast",
        version: 11,
      }),
    );
  };

  const server = net.createServer((socket) => {
    activeSocket = socket;
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0);
        if (buffer.length < length + 4) return;
        const message = JSON.parse(
          buffer.subarray(4, length + 4).toString("utf8"),
        ) as {
          method: string;
          params?: {
            conversationId?: string;
            following?: boolean;
            threadSettings?: { effort: string; model: string };
          };
          requestId?: string;
          sourceClientId?: string;
          targetClientId?: string;
          type: string;
        };
        buffer = buffer.subarray(length + 4);

        if (message.method === "initialize" && message.requestId) {
          socket.write(
            frame({
              requestId: message.requestId,
              result: { clientId: "streamdeck-client" },
              resultType: "success",
              type: "response",
            }),
          );
          sendSelection(socket);
        } else if (
          message.method === "thread-stream-following-changed" &&
          message.type === "broadcast"
        ) {
          socket.write(
            frame({
              ...message,
              type: "broadcast",
            }),
          );
        } else if (
          message.method === "thread-stream-following-status-requested"
        ) {
          statusRequests += 1;
          sendSnapshot(socket);
        } else if (
          message.method === "thread-follower-update-thread-settings" &&
          message.requestId
        ) {
          targets.push(message.targetClientId);
          model = message.params?.threadSettings?.model ?? model;
          effort = message.params?.threadSettings?.effort ?? effort;
          socket.write(
            frame({
              requestId: message.requestId,
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

  const close = async () => {
    activeSocket?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
    fs.rmSync(home, { force: true, recursive: true });
  };
  cleanups.push(close);
  return {
    close,
    home,
    setStoredState: (nextModel, nextEffort) => {
      model = nextModel;
      effort = nextEffort;
    },
    setState: (nextModel, nextEffort) => {
      model = nextModel;
      effort = nextEffort;
      activeSocket?.write(
        frame({
          method: "thread-stream-state-changed",
          params: {
            change: {
              patches: [
                { path: ["latestModel"], value: model },
                { path: ["latestReasoningEffort"], value: effort },
              ],
              type: "patches",
            },
            conversationId: THREAD_A,
            hostId,
          },
          sourceClientId: relayClientId,
          type: "broadcast",
          version: 11,
        }),
      );
    },
    statusRequestCount: () => statusRequests,
    updateTargets: () => targets,
  };
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
      hostId: "local",
      model: "gpt-5.6-sol",
      threadId: THREAD_A,
    });

    const after = await client.update("gpt-5.6-luna", "high", THREAD_A);
    expect(after).toEqual({
      effort: "high",
      hostId: "local",
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

  it("waits for delayed selected-task discovery", async () => {
    const router = await fakeRouter(400);
    const client = new CodexDesktopClient(router.home);

    await expect(client.readState()).resolves.toMatchObject({
      hostId: "local",
      threadId: THREAD_A,
    });
    client.disconnect();
  });

  it("restores the last valid route when Codex does not replay a selection", async () => {
    const router = await fakeRouter(-1);
    const client = new CodexDesktopClient(router.home);
    client.restoreRoute({ hostId: "local", threadId: THREAD_B });

    await expect(client.readState()).resolves.toMatchObject({
      model: "gpt-5.6-terra",
      threadId: THREAD_B,
    });

    router.announce(THREAD_B, false);
    router.announce(THREAD_A, true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(client.readState()).resolves.toMatchObject({
      model: "gpt-5.6-sol",
      threadId: THREAD_A,
    });
    client.disconnect();
  });

  it("restores the parent of an unsaved side chat", async () => {
    const router = await fakeRouter(-1);
    const client = new CodexDesktopClient(router.home);
    client.restoreRoute({ hostId: "local", threadId: THREAD_C });
    await expect(client.readState()).rejects.toMatchObject({
      code: "resolving-task",
    });
    router.snapshot(THREAD_C, {
      effort: "high",
      model: "gpt-5.6-luna",
      parentThreadId: THREAD_A,
      sideConversation: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(client.readState()).resolves.toMatchObject({
      effort: "medium",
      model: "gpt-5.6-sol",
      threadId: THREAD_A,
    });
    client.disconnect();
  });

  it("ignores its own restored-route event before a UI selection", async () => {
    const router = await fakeRouter(-1);
    const client = new CodexDesktopClient(router.home);
    client.restoreRoute({
      hostId: "remote-ssh-discovered:dev",
      threadId: THREAD_B,
    });
    await client.connect();
    await new Promise((resolve) => setTimeout(resolve, 10));

    router.announce(THREAD_A, true);
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(client.readState()).resolves.toMatchObject({
      hostId: "local",
      threadId: THREAD_A,
    });
    client.disconnect();
  });

  it("uses a targeted startup replay instead of a stale saved route", async () => {
    const router = await fakeRouter(-1);
    const client = new CodexDesktopClient(router.home);
    client.restoreRoute({ hostId: "local", threadId: THREAD_B });
    await client.connect();

    router.announce(THREAD_A, true, "desktop-ui-client", true);
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(client.readState()).resolves.toMatchObject({
      model: "gpt-5.6-sol",
      threadId: THREAD_A,
    });
    client.disconnect();
  });

  it("reports a new route for persistence", async () => {
    const router = await fakeRouter();
    const routes: unknown[] = [];
    const client = new CodexDesktopClient(
      router.home,
      async (_current, target) => target,
      (route) => routes.push(route),
    );
    await client.readState();
    router.announce(THREAD_B, true);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(routes.at(-1)).toEqual({ hostId: "local", threadId: THREAD_B });
    client.disconnect();
  });

  it("uses repeated following events as the current selection", async () => {
    const router = await fakeRouter();
    const client = new CodexDesktopClient(router.home);
    await client.readState();

    router.announce(THREAD_B, true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(client.readState()).resolves.toMatchObject({
      model: "gpt-5.6-terra",
      threadId: THREAD_B,
    });

    router.announce(THREAD_A, true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(client.readState()).resolves.toMatchObject({
      model: "gpt-5.6-sol",
      threadId: THREAD_A,
    });

    router.announce(THREAD_B, false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(client.readState()).resolves.toMatchObject({
      model: "gpt-5.6-sol",
      threadId: THREAD_A,
    });
    client.disconnect();
  });

  it("accepts a navigation sequence from a different desktop client", async () => {
    const router = await fakeRouter();
    const client = new CodexDesktopClient(router.home);
    await client.readState();

    router.announce(THREAD_A, false, "second-desktop-ui-client");
    router.announce(THREAD_B, true, "second-desktop-ui-client");
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(client.readState()).resolves.toMatchObject({
      effort: "high",
      model: "gpt-5.6-terra",
      threadId: THREAD_B,
    });
    client.disconnect();
  });

  it("ignores a stale active event from another desktop client", async () => {
    const router = await fakeRouter();
    const client = new CodexDesktopClient(router.home);
    await client.readState();

    router.announce(THREAD_A, false);
    router.announce(THREAD_B, true);
    router.announce(THREAD_A, true, "stale-desktop-ui-client");
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(client.readState()).resolves.toMatchObject({
      effort: "high",
      model: "gpt-5.6-terra",
      threadId: THREAD_B,
    });
    client.disconnect();
  });

  it("does not refresh for a repeated active-task event", async () => {
    const router = await fakeRouter();
    const client = new CodexDesktopClient(router.home);
    await client.readState();
    let changes = 0;
    client.onChange(() => {
      changes += 1;
    });

    router.announce(THREAD_A, true);
    router.announce(THREAD_A, true);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(changes).toBe(0);
    client.disconnect();
  });

  it("maps a selected side chat to its parent task", async () => {
    const router = await fakeRouter();
    const client = new CodexDesktopClient(router.home);
    await client.readState();

    router.announce(THREAD_B, true);
    router.snapshot(THREAD_B, {
      parentThreadId: THREAD_A,
      sideConversation: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(client.readState()).resolves.toMatchObject({
      model: "gpt-5.6-sol",
      threadId: THREAD_A,
    });

    await expect(
      client.update("gpt-5.6-luna", "high", THREAD_A),
    ).resolves.toMatchObject({
      model: "gpt-5.6-luna",
      threadId: THREAD_A,
    });
    expect(router.updateCount()).toBe(1);

    router.announce(THREAD_B, false);
    router.announce(THREAD_A, true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(client.readState()).resolves.toMatchObject({
      model: "gpt-5.6-luna",
      threadId: THREAD_A,
    });
    client.disconnect();
  });

  it("keeps the parent active after an unsaved side chat gets its snapshot", async () => {
    const router = await fakeRouter();
    const client = new CodexDesktopClient(router.home);
    await client.readState();

    router.announce(THREAD_C, true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(client.readState()).rejects.toMatchObject({
      code: "resolving-task",
    });
    expect(router.updateCount()).toBe(0);

    router.snapshot(THREAD_C, {
      effort: "high",
      model: "gpt-5.6-luna",
      parentThreadId: THREAD_A,
      sideConversation: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(client.readState()).resolves.toMatchObject({
      effort: "medium",
      model: "gpt-5.6-sol",
      threadId: THREAD_A,
    });
    client.disconnect();
  });

  it("does not expose the old task during a navigation transition", async () => {
    const router = await fakeRouter();
    const client = new CodexDesktopClient(router.home);
    await client.readState();

    router.announce(THREAD_A, false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(client.readState()).rejects.toMatchObject({
      code: "resolving-task",
    });

    router.announce(THREAD_B, true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(client.readState()).resolves.toMatchObject({
      model: "gpt-5.6-terra",
      threadId: THREAD_B,
    });
    client.disconnect();
  });

  it("does not restore a superseded unsaved route", async () => {
    const router = await fakeRouter();
    const client = new CodexDesktopClient(router.home);
    await client.readState();

    router.announce(THREAD_C, true);
    router.announce(THREAD_B, true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(client.readState()).resolves.toMatchObject({
      threadId: THREAD_B,
    });

    router.announce(THREAD_B, false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(client.readState()).rejects.toMatchObject({
      code: "resolving-task",
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    await expect(client.readState()).rejects.toMatchObject({
      code: "select-task",
    });
    client.disconnect();
  });

  it("keeps the main task when a side chat has no valid parent route", async () => {
    const router = await fakeRouter();
    const client = new CodexDesktopClient(router.home);
    await client.readState();

    router.announce(THREAD_C, true);
    router.snapshot(THREAD_C, {
      effort: "high",
      model: "gpt-5.6-luna",
      sideConversation: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(client.readState()).resolves.toMatchObject({
      effort: "medium",
      model: "gpt-5.6-sol",
      threadId: THREAD_A,
    });
    client.disconnect();
  });

  it("reads a new unsaved task from its live snapshot", async () => {
    const router = await fakeRouter();
    const client = new CodexDesktopClient(router.home);
    await client.readState();

    router.announce(THREAD_C, true);
    router.snapshot(THREAD_C, {
      effort: "high",
      model: "gpt-5.6-luna",
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(client.readState()).resolves.toEqual({
      effort: "high",
      hostId: "local",
      model: "gpt-5.6-luna",
      threadId: THREAD_C,
    });
    client.disconnect();
  });

  it("refreshes a local task from the database after a live snapshot", async () => {
    const router = await fakeRouter();
    const client = new CodexDesktopClient(router.home);
    await client.readState();
    router.snapshot(THREAD_A);
    await new Promise((resolve) => setTimeout(resolve, 10));

    router.setState(THREAD_A, "gpt-5.6-luna", "high");

    await expect(client.readState()).resolves.toMatchObject({
      effort: "high",
      model: "gpt-5.6-luna",
      threadId: THREAD_A,
    });
    client.disconnect();
  });

  it("reads and updates a selected remote task through its live owner", async () => {
    const router = await fakeRemoteRouter();
    const applied: unknown[] = [];
    const client = new CodexDesktopClient(
      router.home,
      async (current, target) => {
        applied.push({ current, target });
        router.setState(target.model, target.effort);
        return target;
      },
    );

    const before = await client.readState();
    expect(before).toEqual({
      effort: "high",
      hostId: "remote-ssh-discovered:dev",
      model: "gpt-5.6-luna",
      threadId: THREAD_A,
    });

    const after = await client.update(
      "gpt-5.6-sol",
      "medium",
      THREAD_A,
      "remote-ssh-discovered:dev",
    );
    expect(after).toEqual({
      effort: "medium",
      hostId: "remote-ssh-discovered:dev",
      model: "gpt-5.6-sol",
      threadId: THREAD_A,
    });
    expect(applied).toEqual([
      {
        current: expect.objectContaining({
          effort: "high",
          hostId: "remote-ssh-discovered:dev",
          model: "gpt-5.6-luna",
          threadId: THREAD_A,
        }),
        target: { effort: "medium", model: "gpt-5.6-sol" },
      },
    ]);
    expect(router.updateTargets()).toEqual([]);

    router.setState("gpt-5.6-luna", "high");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(client.readState()).resolves.toMatchObject({
      effort: "high",
      model: "gpt-5.6-luna",
    });
    client.disconnect();
  });

  it("requests a fresh remote snapshot during a periodic read", async () => {
    const router = await fakeRemoteRouter();
    const client = new CodexDesktopClient(router.home);
    await client.readState();
    let changes = 0;
    client.onChange(() => {
      changes += 1;
    });
    const initialRequests = router.statusRequestCount();
    router.setStoredState("gpt-5.6-sol", "medium");

    await client.readState();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(router.statusRequestCount()).toBeGreaterThan(initialRequests);
    await expect(client.readState()).resolves.toMatchObject({
      effort: "medium",
      model: "gpt-5.6-sol",
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(changes).toBe(1);
    client.disconnect();
  });
});
