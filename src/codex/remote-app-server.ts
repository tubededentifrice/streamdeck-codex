import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import crypto from "node:crypto";

import type { CodexState } from "../domain/settings";

const HOST_ID_PREFIX = "remote-ssh-discovered:";
const SSH_ALIAS = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/;
const THREAD_ID = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_FRAME_SIZE = 16 * 1024 * 1024;
const MAX_HANDSHAKE_SIZE = 64 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const IDLE_TIMEOUT_MS = 2 * 60 * 1_000;

type PendingRequest = {
  method: string;
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

type SpawnSsh = typeof spawn;

export type RemoteAppServerClient = {
  close: () => void;
  update: (
    threadId: string,
    target: Pick<CodexState, "effort" | "model">,
  ) => Promise<void>;
};

type ConnectRemote = (sshAlias: string) => Promise<RemoteAppServerClient>;

class RemoteRequestRejectedError extends Error {}

function timeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out.`)),
        milliseconds,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function websocketFrame(opcode: number, payload = Buffer.alloc(0)): Buffer {
  const mask = crypto.randomBytes(4);
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | payload.length;
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  header[0] = 0x80 | opcode;
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1)
    masked[index] = payload[index] ^ mask[index % 4];
  return Buffer.concat([header, mask, masked]);
}

export function sshAliasFromHostId(hostId: string): string {
  if (!hostId.startsWith(HOST_ID_PREFIX))
    throw new Error("The selected remote task does not provide an SSH route.");
  const alias = hostId.slice(HOST_ID_PREFIX.length);
  if (!SSH_ALIAS.test(alias))
    throw new Error("Codex provided an invalid SSH host alias.");
  return alias;
}

export function sshArguments(host: string): string[] {
  if (!SSH_ALIAS.test(host)) throw new Error("The SSH host alias is invalid.");
  return [
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
    host,
    "codex",
    "app-server",
    "proxy",
  ];
}

export class SshAppServerClient implements RemoteAppServerClient {
  readonly #host: string;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #spawnSsh: SpawnSsh;
  #buffer = Buffer.alloc(0);
  #child: ChildProcessWithoutNullStreams | undefined;
  #fragment = Buffer.alloc(0);
  #handshakeReject: ((error: Error) => void) | undefined;
  #handshakeResolve: (() => void) | undefined;
  #nextId = 1;
  #ready = false;

  constructor(host: string, spawnSsh: SpawnSsh = spawn) {
    if (!SSH_ALIAS.test(host))
      throw new Error("The SSH host alias is invalid.");
    this.#host = host;
    this.#spawnSsh = spawnSsh;
  }

  async connect(): Promise<void> {
    if (this.#child) return;
    const child = this.#spawnSsh("/usr/bin/ssh", sshArguments(this.#host), {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;
    child.stdout.on("data", (chunk: Buffer) => this.#onData(chunk));
    child.stderr.on("data", () => undefined);
    child.once("error", (error) => this.#fail(error));
    child.once("exit", () =>
      this.#fail(new Error("The remote Codex App Server connection closed.")),
    );

    const key = crypto.randomBytes(16).toString("base64");
    const expectedAccept = crypto
      .createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    const handshake = new Promise<void>((resolve, reject) => {
      this.#handshakeResolve = resolve;
      this.#handshakeReject = reject;
    });
    child.stdin.write(
      `GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
    try {
      await timeout(handshake, REQUEST_TIMEOUT_MS, "Remote Codex connection");
      const header = this.#fragment.toString("utf8");
      this.#fragment = Buffer.alloc(0);
      if (
        !header
          .toLowerCase()
          .includes(`sec-websocket-accept: ${expectedAccept}`.toLowerCase())
      )
        throw new Error(
          "The remote Codex App Server returned an invalid handshake.",
        );
      await this.#request("initialize", {
        capabilities: { experimentalApi: true, requestAttestation: false },
        clientInfo: {
          name: "codex_streamdeck",
          title: "Codex Controls for Stream Deck",
          version: "0.1.0",
        },
      });
      this.#notify("initialized", {});
    } catch (error) {
      this.close();
      throw error;
    }
  }

  async update(
    threadId: string,
    target: Pick<CodexState, "effort" | "model">,
  ): Promise<void> {
    if (!THREAD_ID.test(threadId))
      throw new Error("The selected task ID is invalid.");
    await this.connect();
    const models = (await this.#request("model/list", {
      includeHidden: false,
      limit: 100,
    })) as
      | {
          data?: Array<{
            id?: unknown;
            model?: unknown;
            supportedReasoningEfforts?: Array<{ reasoningEffort?: unknown }>;
          }>;
        }
      | undefined;
    const model = models?.data?.find(
      (entry) => entry.id === target.model || entry.model === target.model,
    );
    if (!model)
      throw new RemoteRequestRejectedError(
        `The remote host does not offer ${target.model}.`,
      );
    const efforts = model.supportedReasoningEfforts?.map(
      (entry) => entry.reasoningEffort,
    );
    if (!efforts?.includes(target.effort))
      throw new RemoteRequestRejectedError(
        `${target.model} does not offer ${target.effort} thinking on the remote host.`,
      );

    await this.#request("thread/settings/update", {
      effort: target.effort,
      model: target.model,
      threadId,
    });
  }

  close(): void {
    const child = this.#child;
    this.#child = undefined;
    this.#ready = false;
    if (child) {
      try {
        child.stdin.write(websocketFrame(8));
      } catch {
        // The connection is already closed.
      }
      child.kill("SIGTERM");
    }
    this.#rejectPending(
      new Error("The remote Codex App Server connection closed."),
    );
  }

  #request(method: string, params: unknown): Promise<unknown> {
    if (!this.#child || !this.#ready)
      return Promise.reject(
        new Error("The remote Codex App Server is not connected."),
      );
    const id = String(this.#nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Remote Codex request ${method} timed out.`));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { method, reject, resolve, timer });
      this.#sendJson({ id, method, params });
    });
  }

  #notify(method: string, params: unknown): void {
    this.#sendJson({ method, params });
  }

  #sendJson(value: unknown): void {
    if (!this.#child || !this.#ready)
      throw new Error("The remote Codex App Server is not connected.");
    this.#child.stdin.write(
      websocketFrame(1, Buffer.from(JSON.stringify(value), "utf8")),
    );
  }

  #onData(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    if (!this.#ready) {
      const end = this.#buffer.indexOf("\r\n\r\n");
      if (end < 0) {
        if (this.#buffer.length > MAX_HANDSHAKE_SIZE)
          this.#fail(
            new Error("The remote Codex App Server handshake is too large."),
          );
        return;
      }
      const header = this.#buffer.subarray(0, end + 4).toString("utf8");
      this.#buffer = this.#buffer.subarray(end + 4);
      if (!header.startsWith("HTTP/1.1 101")) {
        this.#handshakeReject?.(
          new Error(
            "The remote Codex App Server rejected the WebSocket connection.",
          ),
        );
        return;
      }
      this.#ready = true;
      this.#fragment = Buffer.from(header, "utf8");
      this.#handshakeResolve?.();
    }
    this.#parseFrames();
  }

  #parseFrames(): void {
    while (this.#buffer.length >= 2) {
      const first = this.#buffer[0];
      const second = this.#buffer[1];
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.#buffer.length < 4) return;
        length = this.#buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.#buffer.length < 10) return;
        const wide = this.#buffer.readBigUInt64BE(2);
        if (wide > BigInt(MAX_FRAME_SIZE)) {
          this.#fail(
            new Error("The remote Codex App Server frame is too large."),
          );
          return;
        }
        length = Number(wide);
        offset = 10;
      }
      if (length > MAX_FRAME_SIZE) {
        this.#fail(
          new Error("The remote Codex App Server frame is too large."),
        );
        return;
      }
      const masked = Boolean(second & 0x80);
      const maskLength = masked ? 4 : 0;
      if (this.#buffer.length < offset + maskLength + length) return;
      const mask = masked
        ? this.#buffer.subarray(offset, offset + 4)
        : undefined;
      const payload = Buffer.from(
        this.#buffer.subarray(
          offset + maskLength,
          offset + maskLength + length,
        ),
      );
      this.#buffer = this.#buffer.subarray(offset + maskLength + length);
      if (mask)
        for (let index = 0; index < payload.length; index += 1)
          payload[index] ^= mask[index % 4];
      const opcode = first & 0x0f;
      const final = Boolean(first & 0x80);
      if (opcode === 9) {
        this.#child?.stdin.write(websocketFrame(10, payload));
        continue;
      }
      if (opcode === 8) {
        this.#fail(
          new Error("The remote Codex App Server closed the connection."),
        );
        return;
      }
      if (opcode === 1) this.#fragment = payload;
      else if (opcode === 0)
        this.#fragment = Buffer.concat([this.#fragment, payload]);
      else continue;
      if (this.#fragment.length > MAX_FRAME_SIZE) {
        this.#fail(
          new Error("The remote Codex App Server message is too large."),
        );
        return;
      }
      if (!final) continue;
      const text = this.#fragment.toString("utf8");
      this.#fragment = Buffer.alloc(0);
      let message: {
        error?: { message?: unknown };
        id?: unknown;
        result?: unknown;
      };
      try {
        message = JSON.parse(text) as typeof message;
      } catch {
        this.#fail(
          new Error("The remote Codex App Server returned malformed data."),
        );
        return;
      }
      if (message.id === undefined) continue;
      const id = String(message.id);
      const pending = this.#pending.get(id);
      if (!pending) continue;
      this.#pending.delete(id);
      clearTimeout(pending.timer);
      if (message.error)
        pending.reject(
          new RemoteRequestRejectedError(
            `Remote Codex rejected ${pending.method}.`,
          ),
        );
      else pending.resolve(message.result);
    }
  }

  #fail(error: Error): void {
    this.#handshakeReject?.(error);
    this.#rejectPending(error);
    const child = this.#child;
    this.#child = undefined;
    this.#ready = false;
    if (child && !child.killed) child.kill("SIGTERM");
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

export class RemoteTaskUpdater {
  readonly #clients = new Map<
    string,
    { client: RemoteAppServerClient; idleTimer: ReturnType<typeof setTimeout> }
  >();
  readonly #connect: ConnectRemote;

  constructor(
    connect: ConnectRemote = async (host) => {
      const client = new SshAppServerClient(host);
      await client.connect();
      return client;
    },
  ) {
    this.#connect = connect;
  }

  async update(
    current: Pick<CodexState, "effort" | "hostId" | "model" | "threadId">,
    target: Pick<CodexState, "effort" | "model">,
  ): Promise<void> {
    const host = sshAliasFromHostId(current.hostId);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const client = await this.#client(host);
        await client.update(current.threadId, target);
        this.#refreshIdleTimer(host, client);
        return;
      } catch (error) {
        lastError = error;
        if (error instanceof RemoteRequestRejectedError) throw error;
        this.#remove(host);
      }
    }
    throw new Error(
      "Codex could not update the selected remote task through SSH.",
      {
        cause: lastError,
      },
    );
  }

  close(): void {
    for (const host of [...this.#clients.keys()]) this.#remove(host);
  }

  async #client(host: string): Promise<RemoteAppServerClient> {
    const existing = this.#clients.get(host);
    if (existing) return existing.client;
    for (const previousHost of [...this.#clients.keys()])
      this.#remove(previousHost);
    const client = await this.#connect(host);
    const idleTimer = setTimeout(() => this.#remove(host), IDLE_TIMEOUT_MS);
    idleTimer.unref();
    this.#clients.set(host, { client, idleTimer });
    return client;
  }

  #refreshIdleTimer(host: string, client: RemoteAppServerClient): void {
    const entry = this.#clients.get(host);
    if (!entry || entry.client !== client) return;
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => this.#remove(host), IDLE_TIMEOUT_MS);
    entry.idleTimer.unref();
  }

  #remove(host: string): void {
    const entry = this.#clients.get(host);
    if (!entry) return;
    this.#clients.delete(host);
    clearTimeout(entry.idleTimer);
    entry.client.close();
  }
}

const remoteTaskUpdater = new RemoteTaskUpdater();
process.once("exit", () => remoteTaskUpdater.close());

export function updateRemoteTaskThroughSsh(
  current: Pick<CodexState, "effort" | "hostId" | "model" | "threadId">,
  target: Pick<CodexState, "effort" | "model">,
): Promise<void> {
  return remoteTaskUpdater.update(current, target);
}
