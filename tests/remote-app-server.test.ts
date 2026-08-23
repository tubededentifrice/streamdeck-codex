import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  RemoteTaskUpdater,
  SshAppServerClient,
  sshAliasFromHostId,
  sshArguments,
  type RemoteAppServerClient,
} from "../src/codex/remote-app-server";

const CURRENT = {
  effort: "high",
  hostId: "remote-ssh-discovered:dev",
  model: "gpt-5.6-luna",
  threadId: "01a0286f-48d3-75b3-ab3d-f773412ab487",
};
const TARGET = { effort: "medium", model: "gpt-5.6-sol" };

function serverFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value));
  if (payload.length >= 126) throw new Error("The test frame is too large.");
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

function fakeSshAppServer(): {
  methods: string[];
  spawnSsh: typeof spawn;
} {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const events = new EventEmitter();
  const child = Object.assign(events, {
    killed: false,
    kill() {
      this.killed = true;
      return true;
    },
    stderr,
    stdin,
    stdout,
  }) as unknown as ChildProcessWithoutNullStreams;
  const methods: string[] = [];
  let buffer = Buffer.alloc(0);
  let handshaken = false;
  let settingsApplied = false;

  const respond = (id: unknown, result: unknown) => {
    stdout.write(serverFrame({ id, result }));
  };
  stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!handshaken) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const header = buffer.subarray(0, end + 4).toString("utf8");
      buffer = buffer.subarray(end + 4);
      const key = /Sec-WebSocket-Key: ([^\r\n]+)/.exec(header)?.[1];
      if (!key)
        throw new Error("The test client did not send a WebSocket key.");
      const accept = crypto
        .createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      handshaken = true;
      stdout.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
    }

    while (buffer.length >= 6) {
      const second = buffer[1];
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 8) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      }
      const total = offset + 4 + length;
      if (buffer.length < total) return;
      const mask = buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(buffer.subarray(offset + 4, total));
      buffer = buffer.subarray(total);
      for (let index = 0; index < payload.length; index += 1)
        payload[index] ^= mask[index % 4];
      if ((payload[0] ?? 0) === 0) continue;
      const message = JSON.parse(payload.toString("utf8")) as {
        id?: unknown;
        method?: string;
      };
      if (!message.method) continue;
      methods.push(message.method);
      if (message.id === undefined) continue;
      if (message.method === "initialize") respond(message.id, {});
      if (message.method === "model/list")
        respond(message.id, {
          data: [
            {
              id: TARGET.model,
              supportedReasoningEfforts: [{ reasoningEffort: TARGET.effort }],
            },
          ],
        });
      if (message.method === "thread/resume")
        respond(message.id, {
          model: settingsApplied ? TARGET.model : CURRENT.model,
          reasoningEffort: settingsApplied ? TARGET.effort : CURRENT.effort,
        });
      if (message.method === "thread/settings/update") {
        settingsApplied = true;
        respond(message.id, {});
      }
    }
  });

  return {
    methods,
    spawnSsh: vi.fn(() => child) as unknown as typeof spawn,
  };
}

describe("remote Codex App Server", () => {
  it("extracts the SSH alias that Codex reports for the selected task", () => {
    expect(sshAliasFromHostId("remote-ssh-discovered:dev")).toBe("dev");
    expect(sshAliasFromHostId("remote-ssh-discovered:build.example-1")).toBe(
      "build.example-1",
    );
  });

  it.each([
    "local",
    "remote-ssh-discovered:",
    "remote-ssh-discovered:-oProxyCommand=bad",
    "remote-ssh-discovered:dev;bad",
  ])("rejects an unsafe or unsupported host ID: %s", (hostId) => {
    expect(() => sshAliasFromHostId(hostId)).toThrow();
  });

  it("uses a fixed non-interactive SSH command", () => {
    expect(sshArguments("dev")).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=5",
      "-o",
      "PermitLocalCommand=no",
      "-o",
      "ServerAliveCountMax=2",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "StrictHostKeyChecking=yes",
      "dev",
      "codex",
      "app-server",
      "proxy",
    ]);
  });

  it("resumes a remote thread before the fallback settings update", async () => {
    const server = fakeSshAppServer();
    const client = new SshAppServerClient("dev", server.spawnSsh);

    await expect(client.update(CURRENT.threadId, TARGET)).resolves.toEqual(
      TARGET,
    );

    expect(server.methods).toEqual([
      "initialize",
      "initialized",
      "model/list",
      "thread/resume",
      "thread/settings/update",
      "thread/resume",
    ]);
    client.close();
  });

  it("reuses one connection for the detected host", async () => {
    const update = vi.fn(
      async (_threadId: string, target: typeof TARGET) => target,
    );
    const close = vi.fn();
    const connect = vi.fn(async (): Promise<RemoteAppServerClient> => ({
      close,
      update,
      validate: vi.fn(async () => undefined),
    }));
    const updater = new RemoteTaskUpdater(connect);

    await updater.update(CURRENT, TARGET);
    await updater.update(CURRENT, {
      effort: "high",
      model: "gpt-5.6-luna",
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith("dev");
    expect(update).toHaveBeenNthCalledWith(1, CURRENT.threadId, TARGET);
    expect(update).toHaveBeenCalledTimes(2);
    updater.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("reconnects once after a failed remote request", async () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const connect = vi
      .fn<() => Promise<RemoteAppServerClient>>()
      .mockResolvedValueOnce({
        close: firstClose,
        update: vi.fn(async () => {
          throw new Error("connection closed");
        }),
        validate: vi.fn(async () => undefined),
      })
      .mockResolvedValueOnce({
        close: secondClose,
        update: vi.fn(async (_threadId, target) => target),
        validate: vi.fn(async () => undefined),
      });
    const updater = new RemoteTaskUpdater(connect);

    await expect(updater.update(CURRENT, TARGET)).resolves.toEqual(TARGET);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(firstClose).toHaveBeenCalledOnce();
    updater.close();
    expect(secondClose).toHaveBeenCalledOnce();
  });

  it("reports a bounded error after two failed connections", async () => {
    const connect = vi.fn(async () => {
      throw new Error("private SSH detail");
    });
    const updater = new RemoteTaskUpdater(connect);

    await expect(updater.update(CURRENT, TARGET)).rejects.toThrow(
      "Codex could not update the selected remote task through SSH. Last failure: remote-transport-failure",
    );
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("validates through the detected remote host", async () => {
    const validate = vi.fn(async () => undefined);
    const connect = vi.fn(async (): Promise<RemoteAppServerClient> => ({
      close: vi.fn(),
      update: vi.fn(async (_threadId, target) => target),
      validate,
    }));
    const updater = new RemoteTaskUpdater(connect);

    await updater.validate(CURRENT, TARGET);

    expect(connect).toHaveBeenCalledWith("dev");
    expect(validate).toHaveBeenCalledWith(TARGET);
    updater.close();
  });
});
