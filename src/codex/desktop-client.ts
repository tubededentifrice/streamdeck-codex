import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { CodexState } from "../domain/settings";
import { sanitizeCodexRoute, type CodexRoute } from "../domain/route";
import { updateRemoteTaskThroughSsh } from "./remote-app-server";

const THREAD_ID = /^[A-Za-z0-9_-]{8,128}$/;
const STATE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_FRAME_SIZE = 16 * 1024 * 1024;

type PendingRequest = {
  method: string;
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

type RemoteUpdater = (
  current: Pick<CodexState, "effort" | "hostId" | "model" | "threadId">,
  target: Pick<CodexState, "effort" | "model">,
) => Promise<void>;

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
  readonly #remoteUpdater: RemoteUpdater;
  readonly #routeChanged: (route: CodexRoute | undefined) => void;
  readonly #listeners = new Set<() => void>();
  readonly #pending = new Map<string, PendingRequest>();
  readonly #remoteStates = new Map<
    string,
    CodexState & { relayClientId: string }
  >();
  readonly #followedRoutes = new Map<
    string,
    { hostId: string; threadId: string }
  >();
  #activeRouteKey: string | undefined;
  #buffer = Buffer.alloc(0);
  #clientId: string | undefined;
  #connectPromise: Promise<void> | undefined;
  #database: DatabaseSync | undefined;
  #selectionSourceClientId: string | undefined;
  #socket: net.Socket | undefined;

  constructor(
    codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    remoteUpdater: RemoteUpdater = updateRemoteTaskThroughSsh,
    routeChanged: (route: CodexRoute | undefined) => void = () => undefined,
  ) {
    this.#codexHome = codexHome;
    this.#remoteUpdater = remoteUpdater;
    this.#routeChanged = routeChanged;
  }

  restoreRoute(value: unknown): void {
    const route = sanitizeCodexRoute(value);
    if (!route || this.#activeRouteKey) return;
    const key = this.#routeKey(route.hostId, route.threadId);
    this.#followedRoutes.set(key, route);
    this.#activeRouteKey = key;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  disconnect(): void {
    this.#close(new Error("Codex desktop connection closed."), false);
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
    const route = await this.#selectedRoute();
    if (route.hostId !== "local") return this.#readRemoteState(route);
    const database = this.#getDatabase();
    const row = database
      .prepare("SELECT model, reasoning_effort FROM threads WHERE id = ?")
      .get(route.threadId) as
      { model?: unknown; reasoning_effort?: unknown } | undefined;
    if (!row || !isStateValue(row.model)) {
      throw new Error(
        "The selected task has no saved model and thinking level.",
      );
    }
    if (!isStateValue(row.reasoning_effort))
      throw new Error("The selected task has an invalid thinking level.");
    return {
      effort: row.reasoning_effort,
      hostId: route.hostId,
      model: row.model,
      threadId: route.threadId,
    };
  }

  async update(
    model: string,
    effort: string,
    expectedThreadId: string,
    expectedHostId = "local",
  ): Promise<CodexState> {
    const before = await this.readState();
    if (
      before.threadId !== expectedThreadId ||
      before.hostId !== expectedHostId
    )
      throw new Error("The selected task changed before the update.");
    const currentRoute = await this.#selectedRoute();
    if (
      currentRoute.threadId !== before.threadId ||
      currentRoute.hostId !== before.hostId
    )
      throw new Error("The selected task changed before the update.");
    if (before.hostId === "local") {
      const result = (await this.#request(
        "thread-follower-update-thread-settings",
        {
          conversationId: before.threadId,
          threadSettings: { effort, model },
        },
      )) as { ok?: unknown } | undefined;
      if (result?.ok !== true)
        throw new Error("Codex desktop did not confirm the settings update.");
    } else {
      await this.#remoteUpdater(before, { effort, model });
    }

    if (before.hostId !== "local") {
      this.#requestRemoteStatus(before);
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const state = await this.readState();
      if (state.threadId !== before.threadId || state.hostId !== before.hostId)
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
      const restored = this.#activeRouteKey
        ? this.#followedRoutes.get(this.#activeRouteKey)
        : undefined;
      if (restored && restored.hostId !== "local")
        this.#followRemote(restored, true);
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

  async #selectedRoute(): Promise<{ hostId: string; threadId: string }> {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const selected = this.#activeRouteKey
        ? this.#followedRoutes.get(this.#activeRouteKey)
        : undefined;
      if (selected) return selected;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Select a task in the Codex desktop app.");
  }

  async #readRemoteState(route: {
    hostId: string;
    threadId: string;
  }): Promise<CodexState> {
    const key = this.#routeKey(route.hostId, route.threadId);
    let state = this.#remoteStates.get(key);
    if (!state) {
      this.#requestRemoteStatus(route);
      for (let attempt = 0; attempt < 25 && !state; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        state = this.#remoteStates.get(key);
      }
    }
    if (!state)
      throw new Error("Codex did not provide the selected remote task state.");
    return {
      effort: state.effort,
      hostId: state.hostId,
      model: state.model,
      threadId: state.threadId,
    };
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
    targetClientId?: string,
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
      ...(targetClientId ? { targetClientId } : {}),
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

  #broadcast(method: string, version: number, params: unknown): void {
    if (!this.#socket || this.#socket.destroyed || !this.#clientId) return;
    this.#socket.write(
      encodeFrame({
        type: "broadcast",
        sourceClientId: this.#clientId,
        method,
        version,
        params,
      }),
    );
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
          | {
              conversationId?: unknown;
              following?: unknown;
              hostId?: unknown;
            }
          | undefined;
        if (
          typeof params?.conversationId === "string" &&
          THREAD_ID.test(params.conversationId) &&
          typeof params.hostId === "string" &&
          typeof params.following === "boolean"
        ) {
          const targeted = Array.isArray(message.targetClientIds);
          const sourceClientId =
            typeof message.sourceClientId === "string"
              ? message.sourceClientId
              : undefined;
          if (!this.#selectionSourceClientId && sourceClientId)
            this.#selectionSourceClientId = sourceClientId;
          const fromSelectionSource =
            !sourceClientId || sourceClientId === this.#selectionSourceClientId;
          if (!targeted && fromSelectionSource) {
            const route = {
              hostId: params.hostId,
              threadId: params.conversationId,
            };
            const key = this.#routeKey(route.hostId, route.threadId);
            if (params.following) {
              if (this.#followedRoutes.has(key)) continue;
              const previous = this.#activeRouteKey
                ? this.#followedRoutes.get(this.#activeRouteKey)
                : undefined;
              if (previous && previous.hostId !== "local")
                this.#followRemote(previous, false);
              this.#followedRoutes.set(key, route);
              this.#activeRouteKey = key;
              this.#remoteStates.clear();
              this.#routeChanged(route);
              if (route.hostId !== "local") this.#followRemote(route, true);
            } else {
              if (!this.#followedRoutes.delete(key)) continue;
              this.#remoteStates.delete(key);
              if (route.hostId !== "local") this.#followRemote(route, false);
              if (this.#activeRouteKey === key) {
                const fallback = [...this.#followedRoutes.entries()].at(-1);
                this.#activeRouteKey = fallback?.[0];
                this.#routeChanged(fallback?.[1]);
                if (fallback && fallback[1].hostId !== "local") {
                  this.#remoteStates.clear();
                  this.#followRemote(fallback[1], true);
                }
              }
            }
            this.#emitChange();
          }
        }
      }

      if (
        message.method === "thread-stream-state-changed" &&
        message.version === 11
      ) {
        this.#handleRemoteState(message);
      }

      if (
        message.type === "response" &&
        typeof message.requestId === "string"
      ) {
        const pending = this.#pending.get(message.requestId);
        if (!pending) continue;
        this.#pending.delete(message.requestId);
        clearTimeout(pending.timer);
        if (message.resultType === "success") {
          pending.resolve(message.result);
        } else
          pending.reject(
            new Error(`Codex desktop rejected ${pending.method}.`),
          );
      }
    }
  }

  #close(error: Error, preserveRoute = true): void {
    const rememberedRoute =
      preserveRoute && this.#activeRouteKey
        ? this.#followedRoutes.get(this.#activeRouteKey)
        : undefined;
    const socket = this.#socket;
    const hadConnection = Boolean(
      socket || this.#clientId || this.#followedRoutes.size > 0,
    );
    this.#socket = undefined;
    this.#clientId = undefined;
    this.#selectionSourceClientId = undefined;
    this.#buffer = Buffer.alloc(0);
    this.#activeRouteKey = undefined;
    this.#followedRoutes.clear();
    this.restoreRoute(rememberedRoute);
    this.#remoteStates.clear();
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

  #followRemote(
    route: { hostId: string; threadId: string },
    following: boolean,
  ): void {
    this.#broadcast("thread-stream-following-changed", 1, {
      conversationId: route.threadId,
      hostId: route.hostId,
      following,
    });
    if (following) this.#requestRemoteStatus(route);
  }

  #requestRemoteStatus(route: { hostId: string; threadId: string }): void {
    this.#broadcast("thread-stream-following-status-requested", 1, {
      conversationId: route.threadId,
      hostId: route.hostId,
    });
  }

  #handleRemoteState(message: Record<string, unknown>): void {
    const params = message.params as
      | { change?: unknown; conversationId?: unknown; hostId?: unknown }
      | undefined;
    if (
      typeof params?.conversationId !== "string" ||
      !THREAD_ID.test(params.conversationId) ||
      typeof params.hostId !== "string" ||
      params.hostId === "local" ||
      typeof message.sourceClientId !== "string" ||
      !params.change ||
      typeof params.change !== "object"
    )
      return;
    const key = this.#routeKey(params.hostId, params.conversationId);
    if (key !== this.#activeRouteKey) return;
    const change = params.change as {
      conversationState?: unknown;
      patches?: unknown;
      type?: unknown;
    };

    if (
      change.type === "snapshot" &&
      change.conversationState &&
      typeof change.conversationState === "object"
    ) {
      const state = change.conversationState as {
        latestModel?: unknown;
        latestReasoningEffort?: unknown;
        latestThreadSettings?: unknown;
      };
      const settings =
        state.latestThreadSettings &&
        typeof state.latestThreadSettings === "object"
          ? (state.latestThreadSettings as {
              effort?: unknown;
              model?: unknown;
              reasoningEffort?: unknown;
            })
          : undefined;
      const model = isStateValue(state.latestModel)
        ? state.latestModel
        : settings?.model;
      const effort = isStateValue(state.latestReasoningEffort)
        ? state.latestReasoningEffort
        : isStateValue(settings?.effort)
          ? settings.effort
          : settings?.reasoningEffort;
      if (isStateValue(model) && isStateValue(effort)) {
        this.#remoteStates.set(key, {
          effort,
          hostId: params.hostId,
          model,
          relayClientId: message.sourceClientId,
          threadId: params.conversationId,
        });
        this.#emitChange();
      }
      return;
    }

    if (change.type !== "patches" || !Array.isArray(change.patches)) return;
    const current = this.#remoteStates.get(key);
    if (!current || current.relayClientId !== message.sourceClientId) return;
    let model = current.model;
    let effort = current.effort;
    for (const patch of change.patches) {
      if (!patch || typeof patch !== "object") continue;
      const { path: patchPath, value } = patch as {
        path?: unknown;
        value?: unknown;
      };
      if (!Array.isArray(patchPath) || patchPath.length === 0) continue;
      if (patchPath[0] === "latestModel" && isStateValue(value)) model = value;
      if (patchPath[0] === "latestReasoningEffort" && isStateValue(value))
        effort = value;
    }
    if (model !== current.model || effort !== current.effort) {
      this.#remoteStates.set(key, { ...current, effort, model });
      this.#emitChange();
    }
  }

  #routeKey(hostId: string, threadId: string): string {
    return `${hostId}\0${threadId}`;
  }
}
