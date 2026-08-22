import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { CodexState } from "../domain/settings";

const THREAD_ID = /^[A-Za-z0-9_-]{8,128}$/;
const STATE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_FRAME_SIZE = 16 * 1024 * 1024;

type PendingRequest = {
  method: string;
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

function encodeFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

function isStateValue(value: unknown): value is string {
  return typeof value === "string" && STATE_VALUE.test(value);
}

export class CodexDesktopClient {
  readonly #codexHome: string;
  readonly #following = new Map<string, boolean>();
  readonly #listeners = new Set<() => void>();
  readonly #pending = new Map<string, PendingRequest>();
  #buffer = Buffer.alloc(0);
  #clientId: string | undefined;
  #connectPromise: Promise<void> | undefined;
  #database: DatabaseSync | undefined;
  #socket: net.Socket | undefined;

  constructor(
    codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  ) {
    this.#codexHome = codexHome;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  disconnect(): void {
    this.#close(new Error("Codex desktop connection closed."));
    this.#database?.close();
    this.#database = undefined;
  }

  async connect(): Promise<void> {
    if (this.#socket && !this.#socket.destroyed && this.#clientId) return;
    if (this.#connectPromise) return this.#connectPromise;
    this.#connectPromise = Promise.resolve()
      .then(() => this.#open())
      .finally(() => {
        this.#connectPromise = undefined;
      });
    return this.#connectPromise;
  }

  async readState(): Promise<CodexState> {
    await this.connect();
    const threadId = this.#selectedThreadId();
    const database = this.#getDatabase();
    const row = database
      .prepare("SELECT model, reasoning_effort FROM threads WHERE id = ?")
      .get(threadId) as
      { model?: unknown; reasoning_effort?: unknown } | undefined;
    if (!row || !isStateValue(row.model)) {
      throw new Error(
        "The selected task has no saved model and thinking level.",
      );
    }
    if (!isStateValue(row.reasoning_effort))
      throw new Error("The selected task has an invalid thinking level.");
    return { effort: row.reasoning_effort, model: row.model, threadId };
  }

  async update(
    model: string,
    effort: string,
    expectedThreadId: string,
  ): Promise<CodexState> {
    const before = await this.readState();
    if (before.threadId !== expectedThreadId)
      throw new Error("The selected task changed before the update.");
    const result = (await this.#request(
      "thread-follower-update-thread-settings",
      {
        conversationId: before.threadId,
        threadSettings: { effort, model },
      },
    )) as { ok?: unknown } | undefined;
    if (result?.ok !== true)
      throw new Error("Codex desktop did not confirm the settings update.");

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const state = await this.readState();
      if (state.threadId !== before.threadId)
        throw new Error("The selected task changed during the update.");
      if (state.model === model && state.effort === effort) {
        this.#emitChange();
        return state;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      "Codex did not save the requested model and thinking level.",
    );
  }

  async #open(): Promise<void> {
    this.#close(new Error("Codex desktop connection was replaced."));
    const socketPath = path.join(this.#codexHome, "ipc", "ipc.sock");
    const info = fs.lstatSync(socketPath);
    if (!info.isSocket())
      throw new Error("The Codex desktop IPC path is not a socket.");
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
      throw new Error("The Codex desktop IPC socket has a different owner.");
    }
    if ((info.mode & 0o077) !== 0)
      throw new Error("The Codex desktop IPC socket is not owner-only.");

    const socket = net.createConnection({ path: socketPath });
    this.#socket = socket;
    socket.on("data", (chunk) => {
      if (this.#socket === socket) this.#onData(chunk);
    });
    socket.on("error", (error) => {
      if (this.#socket === socket) this.#close(error);
    });
    socket.on("close", () => {
      if (this.#socket === socket)
        this.#close(new Error("Codex desktop disconnected."));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error("Codex desktop connection timed out."));
        }, 2500);
        socket.once("connect", () => {
          clearTimeout(timer);
          resolve();
        });
        socket.once("error", () => {
          clearTimeout(timer);
          reject(new Error("Codex desktop connection failed."));
        });
      });

      const result = (await this.#request(
        "initialize",
        { clientType: "codex-streamdeck" },
        0,
      )) as { clientId?: unknown } | undefined;
      if (typeof result?.clientId !== "string")
        throw new Error("Codex desktop did not return a client ID.");
      this.#clientId = result.clientId;
      await new Promise((resolve) => setTimeout(resolve, 250));
    } catch (error) {
      if (this.#socket === socket)
        this.#close(
          error instanceof Error
            ? error
            : new Error("Codex desktop connection failed."),
        );
      throw error;
    }
  }

  #selectedThreadId(): string {
    const selected = [...this.#following.entries()]
      .filter(([, following]) => following)
      .map(([threadId]) => threadId);
    if (selected.length === 0)
      throw new Error("Select a task in the Codex desktop app.");
    if (selected.length > 1)
      throw new Error("Codex reports more than one selected task.");
    return selected[0];
  }

  #getDatabase(): DatabaseSync {
    if (!this.#database) {
      this.#database = new DatabaseSync(
        path.join(this.#codexHome, "state_5.sqlite"),
        { readOnly: true },
      );
    }
    return this.#database;
  }

  #request(
    method: string,
    params: unknown,
    version = 1,
    timeoutMs = 5000,
  ): Promise<unknown> {
    if (!this.#socket || this.#socket.destroyed)
      return Promise.reject(new Error("Codex desktop is not connected."));
    if (version > 0 && !this.#clientId)
      return Promise.reject(new Error("Codex desktop is not initialized."));
    const requestId = crypto.randomUUID();
    const message = {
      method,
      params,
      requestId,
      sourceClientId: version === 0 ? "initializing-client" : this.#clientId,
      type: "request",
      version,
      ...(version > 0 ? { timeoutMs } : {}),
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`Codex desktop request ${method} timed out.`));
      }, timeoutMs + 1000);
      this.#pending.set(requestId, { method, reject, resolve, timer });
      this.#socket?.write(encodeFrame(message));
    });
  }

  #onData(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32LE(0);
      if (!length || length > MAX_FRAME_SIZE) {
        this.#close(new Error("Codex desktop returned an invalid frame."));
        return;
      }
      if (this.#buffer.length < length + 4) return;
      const payload = this.#buffer.subarray(4, length + 4);
      this.#buffer = this.#buffer.subarray(length + 4);
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(payload.toString("utf8")) as Record<
          string,
          unknown
        >;
      } catch {
        this.#close(new Error("Codex desktop returned malformed data."));
        return;
      }

      if (
        message.type === "client-discovery-request" &&
        typeof message.requestId === "string"
      ) {
        this.#socket?.write(
          encodeFrame({
            requestId: message.requestId,
            response: { canHandle: false },
            type: "client-discovery-response",
          }),
        );
      }

      if (
        message.method === "thread-stream-following-changed" &&
        message.version === 1
      ) {
        const params = message.params as
          { conversationId?: unknown; following?: unknown } | undefined;
        if (
          typeof params?.conversationId === "string" &&
          THREAD_ID.test(params.conversationId) &&
          typeof params.following === "boolean"
        ) {
          this.#following.set(params.conversationId, params.following);
          this.#emitChange();
        }
      }

      if (
        message.type === "response" &&
        typeof message.requestId === "string"
      ) {
        const pending = this.#pending.get(message.requestId);
        if (!pending) continue;
        this.#pending.delete(message.requestId);
        clearTimeout(pending.timer);
        if (message.resultType === "success") pending.resolve(message.result);
        else
          pending.reject(
            new Error(`Codex desktop rejected ${pending.method}.`),
          );
      }
    }
  }

  #close(error: Error): void {
    const socket = this.#socket;
    const hadConnection = Boolean(
      socket || this.#clientId || this.#following.size > 0,
    );
    this.#socket = undefined;
    this.#clientId = undefined;
    this.#buffer = Buffer.alloc(0);
    this.#following.clear();
    if (socket && !socket.destroyed) socket.destroy();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    if (hadConnection) this.#emitChange();
  }

  #emitChange(): void {
    for (const listener of this.#listeners) listener();
  }
}
