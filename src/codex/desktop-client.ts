import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { CodexState } from "../domain/settings";
import { sanitizeCodexRoute, type CodexRoute } from "../domain/route";
import { CodexError } from "./errors";

const THREAD_ID = /^[A-Za-z0-9_-]{8,128}$/;
const STATE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_FRAME_SIZE = 16 * 1024 * 1024;

export class IpcFrameDecoder {
  readonly #header = Buffer.allocUnsafe(4);
  readonly #maxFrameSize: number;
  #discardRemaining = 0;
  #frame: Buffer | undefined;
  #frameBytes = 0;
  #headerBytes = 0;

  constructor(maxFrameSize: number) {
    this.#maxFrameSize = maxFrameSize;
  }

  push(chunk: Buffer): Buffer[] {
    const frames: Buffer[] = [];
    let offset = 0;
    while (offset < chunk.length) {
      if (this.#discardRemaining > 0) {
        const discarded = Math.min(
          this.#discardRemaining,
          chunk.length - offset,
        );
        this.#discardRemaining -= discarded;
        offset += discarded;
        continue;
      }

      if (!this.#frame) {
        const headerBytes = Math.min(
          4 - this.#headerBytes,
          chunk.length - offset,
        );
        chunk.copy(
          this.#header,
          this.#headerBytes,
          offset,
          offset + headerBytes,
        );
        this.#headerBytes += headerBytes;
        offset += headerBytes;
        if (this.#headerBytes < 4) continue;

        const length = this.#header.readUInt32LE(0);
        this.#headerBytes = 0;
        if (!length)
          throw new Error("Codex desktop returned an invalid frame.");
        if (length > this.#maxFrameSize) {
          this.#discardRemaining = length;
          continue;
        }
        this.#frame = Buffer.allocUnsafe(length);
        this.#frameBytes = 0;
      }

      const frameBytes = Math.min(
        this.#frame.length - this.#frameBytes,
        chunk.length - offset,
      );
      chunk.copy(this.#frame, this.#frameBytes, offset, offset + frameBytes);
      this.#frameBytes += frameBytes;
      offset += frameBytes;
      if (this.#frameBytes !== this.#frame.length) continue;

      frames.push(this.#frame);
      this.#frame = undefined;
      this.#frameBytes = 0;
    }
    return frames;
  }

  reset(): void {
    this.#discardRemaining = 0;
    this.#frame = undefined;
    this.#frameBytes = 0;
    this.#headerBytes = 0;
  }
}

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
  readonly #decoder = new IpcFrameDecoder(MAX_FRAME_SIZE);
  readonly #routeChanged: (route: CodexRoute | undefined) => void;
  readonly #listeners = new Set<() => void>();
  readonly #pending = new Map<string, PendingRequest>();
  readonly #remoteStates = new Map<
    string,
    CodexState & {
      latestModel?: string;
      latestReasoningEffort?: string;
      parentRoute?: CodexRoute;
      relayClientId: string;
      sideConversation: boolean;
      threadSettingsEffort?: string;
      threadSettingsModel?: string;
    }
  >();
  readonly #followedRoutes = new Map<
    string,
    { hostId: string; threadId: string }
  >();
  readonly #followerTargets = new Map<string, string | undefined>();
  readonly #snapshotRoutes = new Set<string>();
  #activeRouteKey: string | undefined;
  #clientId: string | undefined;
  #connectPromise: Promise<void> | undefined;
  #database: DatabaseSync | undefined;
  #lastReadyRoute: CodexRoute | undefined;
  #pendingLocalCheckTimer: ReturnType<typeof setTimeout> | undefined;
  #pendingRouteKey: string | undefined;
  #routeRevision = 0;
  #selectionClearTimer: ReturnType<typeof setTimeout> | undefined;
  #selectionResolving = false;
  #selectionSourceClientId: string | undefined;
  readonly #selectionTransitions = new Map<string, number>();
  #socket: net.Socket | undefined;

  constructor(
    codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    routeChanged: (route: CodexRoute | undefined) => void = () => undefined,
  ) {
    this.#codexHome = codexHome;
    this.#routeChanged = routeChanged;
  }

  get routeRevision(): number {
    return this.#routeRevision;
  }

  restoreRoute(value: unknown): void {
    const route = sanitizeCodexRoute(value);
    if (!route || this.#activeRouteKey || this.#pendingRouteKey) return;
    const key = this.#routeKey(route.hostId, route.threadId);
    this.#followedRoutes.set(key, route);
    if (route.hostId === "local" && !this.#readLocalState(route.threadId))
      this.#pendingRouteKey = key;
    else {
      this.#activeRouteKey = key;
      this.#lastReadyRoute = route;
    }
    this.#routeRevision += 1;
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
    const live = this.#liveState(route);
    if (live) return live;
    if (route.hostId === "local") {
      const stored = this.#readLocalState(route.threadId);
      if (stored) return stored;
    }
    const discovered = await this.#readLiveState(
      route,
      route.hostId === "local" ? 5 : 25,
    );
    if (discovered) return discovered;
    if (route.hostId !== "local")
      throw new CodexError(
        "task-state-unavailable",
        "Codex did not provide the selected remote task state.",
      );
    throw new CodexError(
      "task-state-unavailable",
      "The selected task has no saved model and thinking level.",
    );
  }

  #readLocalState(threadId: string): CodexState | undefined {
    const database = this.#getDatabase();
    const row = database
      .prepare("SELECT model, reasoning_effort FROM threads WHERE id = ?")
      .get(threadId) as
      { model?: unknown; reasoning_effort?: unknown } | undefined;
    if (!row || !isStateValue(row.model) || !isStateValue(row.reasoning_effort))
      return undefined;
    return {
      effort: row.reasoning_effort,
      hostId: "local",
      model: row.model,
      threadId,
    };
  }

  #liveState(route: {
    hostId: string;
    threadId: string;
  }): CodexState | undefined {
    const state = this.#remoteStates.get(
      this.#routeKey(route.hostId, route.threadId),
    );
    if (!state) return undefined;
    return {
      effort: state.effort,
      hostId: state.hostId,
      model: state.model,
      threadId: state.threadId,
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
      throw new Error(
        "Remote task updates are not supported in this Codex release.",
      );
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const stored =
        before.hostId === "local"
          ? this.#readLocalState(before.threadId)
          : undefined;
      if (stored?.model === model && stored.effort === effort) {
        const key = this.#routeKey(before.hostId, before.threadId);
        const live = this.#remoteStates.get(key);
        if (live) this.#remoteStates.set(key, { ...live, effort, model });
        this.#emitChange();
        return stored;
      }
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
      const restoredKey = this.#activeRouteKey ?? this.#pendingRouteKey;
      const restored = restoredKey
        ? this.#followedRoutes.get(restoredKey)
        : undefined;
      if (restored) {
        if (restored.hostId !== "local") this.#requestThreadStatus(restored);
        else if (this.#pendingRouteKey) this.#setFollower(restored, true);
      }
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
    if (this.#selectionResolving || this.#pendingRouteKey)
      throw new CodexError(
        "resolving-task",
        "Codex is resolving the selected task.",
      );
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const selected = this.#activeRouteKey
        ? this.#followedRoutes.get(this.#activeRouteKey)
        : undefined;
      if (selected) return selected;
      if (this.#selectionResolving || this.#pendingRouteKey)
        throw new CodexError(
          "resolving-task",
          "Codex is resolving the selected task.",
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new CodexError(
      "select-task",
      "Select a task in the Codex desktop app.",
    );
  }

  async #readLiveState(
    route: {
      hostId: string;
      threadId: string;
    },
    attempts: number,
  ): Promise<CodexState | undefined> {
    const key = this.#routeKey(route.hostId, route.threadId);
    let state = this.#remoteStates.get(key);
    if (!state) this.#requestThreadStatus(route);
    if (!state) {
      for (let attempt = 0; attempt < attempts && !state; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        state = this.#remoteStates.get(key);
      }
    }
    if (!state) return undefined;
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
      this.#pending.set(requestId, {
        method,
        reject,
        resolve,
        timer,
      });
      this.#socket?.write(encodeFrame(message));
    });
  }

  #broadcast(
    method: string,
    version: number,
    params: unknown,
    targetClientIds?: string[],
  ): boolean {
    if (!this.#socket || this.#socket.destroyed || !this.#clientId)
      return false;
    this.#socket.write(
      encodeFrame({
        type: "broadcast",
        sourceClientId: this.#clientId,
        method,
        version,
        params,
        ...(targetClientIds ? { targetClientIds } : {}),
      }),
    );
    return true;
  }

  #onData(chunk: Buffer): void {
    let payloads: Buffer[];
    try {
      payloads = this.#decoder.push(chunk);
    } catch (error) {
      this.#close(
        error instanceof Error
          ? error
          : new Error("Codex desktop returned invalid data."),
      );
      return;
    }
    for (const payload of payloads) {
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
          const targetClientIds = Array.isArray(message.targetClientIds)
            ? message.targetClientIds.filter(
                (value): value is string => typeof value === "string",
              )
            : undefined;
          const targeted = targetClientIds !== undefined;
          const sourceClientId =
            typeof message.sourceClientId === "string"
              ? message.sourceClientId
              : undefined;
          if (sourceClientId === this.#clientId) continue;
          const targetedReplay =
            targeted &&
            Boolean(
              this.#clientId && targetClientIds?.includes(this.#clientId),
            ) &&
            params.following &&
            !this.#selectionSourceClientId &&
            !this.#selectionResolving;
          if (targeted && !targetedReplay) continue;
          if (!targeted) {
            if (sourceClientId && !params.following)
              this.#selectionTransitions.set(sourceClientId, Date.now());
            const recentTransition = sourceClientId
              ? Date.now() -
                  (this.#selectionTransitions.get(sourceClientId) ?? 0) <
                2000
              : false;
            const canSelect =
              !sourceClientId ||
              !this.#selectionSourceClientId ||
              sourceClientId === this.#selectionSourceClientId ||
              recentTransition;
            if (params.following && !canSelect) continue;
            if (
              !params.following &&
              sourceClientId &&
              sourceClientId !== this.#selectionSourceClientId
            )
              continue;
          }
          const route = sanitizeCodexRoute({
            hostId: params.hostId,
            threadId: params.conversationId,
          });
          if (!route) continue;
          const key = this.#routeKey(route.hostId, route.threadId);
          if (params.following) {
            if (sourceClientId) {
              this.#selectionSourceClientId = sourceClientId;
              this.#selectionTransitions.delete(sourceClientId);
            }
            this.#followedRoutes.set(key, route);
            const knownState = this.#remoteStates.get(key);
            if (
              route.hostId === "local" &&
              !knownState &&
              !this.#readLocalState(route.threadId)
            ) {
              this.#setFollower(route, true, sourceClientId);
              this.#beginResolving(key);
              continue;
            }
            const selectedRoute = knownState?.sideConversation
              ? knownState.parentRoute
              : route;
            if (!selectedRoute) {
              this.#beginResolving(key);
              continue;
            }
            this.#selectRoute(selectedRoute);
            if (selectedRoute.hostId !== "local") {
              if (knownState)
                this.#setFollower(
                  selectedRoute,
                  true,
                  knownState.relayClientId,
                );
              else this.#requestThreadStatus(selectedRoute);
            }
          } else {
            const wasSelected =
              this.#activeRouteKey === key || this.#pendingRouteKey === key;
            this.#setFollower(route, false);
            this.#followedRoutes.delete(key);
            this.#remoteStates.delete(key);
            if (wasSelected) this.#beginNavigation();
          }
        }
      }

      if (
        message.method === "thread-stream-state-changed" &&
        message.version === 11
      ) {
        this.#handleRemoteState(message);
      }

      if (message.method === "query-cache-invalidate") {
        if (!this.#resolvePendingLocalRoute()) {
          this.#refreshActiveLocalState();
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
        if (message.resultType === "success") {
          pending.resolve(message.result);
        } else
          pending.reject(
            new Error(`Codex desktop rejected ${pending.method}.`),
          );
      }
    }
  }

  #beginNavigation(): void {
    this.#clearPendingLocalCheck();
    this.#activeRouteKey = undefined;
    this.#pendingRouteKey = undefined;
    this.#selectionResolving = true;
    this.#routeRevision += 1;
    this.#emitChange();
    this.#scheduleSelectionClear(300);
  }

  #beginResolving(key: string): void {
    const previousPending = this.#pendingRouteKey;
    if (previousPending && previousPending !== key) {
      this.#setFollower(this.#followedRoutes.get(previousPending), false);
      this.#followedRoutes.delete(previousPending);
      this.#remoteStates.delete(previousPending);
    }
    this.#activeRouteKey = undefined;
    this.#pendingRouteKey = key;
    this.#selectionResolving = true;
    this.#routeRevision += 1;
    this.#emitChange();
    this.#scheduleSelectionClear(2500, key);
    this.#schedulePendingLocalCheck(key);
  }

  #scheduleSelectionClear(milliseconds: number, pendingKey?: string): void {
    if (this.#selectionClearTimer) clearTimeout(this.#selectionClearTimer);
    this.#selectionClearTimer = setTimeout(() => {
      this.#selectionClearTimer = undefined;
      if (!this.#selectionResolving) return;
      if (pendingKey && this.#pendingRouteKey !== pendingKey) return;
      if (pendingKey) {
        this.#setFollower(this.#followedRoutes.get(pendingKey), false);
        this.#followedRoutes.delete(pendingKey);
        this.#remoteStates.delete(pendingKey);
      }
      this.#clearPendingLocalCheck();
      this.#pendingRouteKey = undefined;
      this.#selectionResolving = false;
      this.#lastReadyRoute = undefined;
      this.#routeRevision += 1;
      this.#routeChanged(undefined);
      this.#emitChange();
    }, milliseconds);
    this.#selectionClearTimer.unref();
  }

  #selectRoute(route: CodexRoute): void {
    const key = this.#routeKey(route.hostId, route.threadId);
    const previousActive = this.#activeRouteKey
      ? this.#followedRoutes.get(this.#activeRouteKey)
      : undefined;
    const previousPending = this.#pendingRouteKey;
    const changed =
      this.#activeRouteKey !== key ||
      this.#selectionResolving ||
      previousPending !== undefined;
    if (previousPending && previousPending !== key) {
      this.#setFollower(this.#followedRoutes.get(previousPending), false);
      this.#followedRoutes.delete(previousPending);
      this.#remoteStates.delete(previousPending);
    }
    if (previousActive && this.#activeRouteKey !== key)
      this.#setFollower(previousActive, false);
    this.#clearPendingLocalCheck();
    if (this.#selectionClearTimer) {
      clearTimeout(this.#selectionClearTimer);
      this.#selectionClearTimer = undefined;
    }
    this.#followedRoutes.set(key, route);
    this.#activeRouteKey = key;
    this.#pendingRouteKey = undefined;
    this.#selectionResolving = false;
    this.#lastReadyRoute = route;
    if (!changed) return;
    this.#routeRevision += 1;
    this.#routeChanged(route);
    this.#emitChange();
  }

  #close(error: Error, preserveRoute = true): void {
    const rememberedKey = this.#activeRouteKey ?? this.#pendingRouteKey;
    const rememberedRoute =
      preserveRoute && rememberedKey
        ? (this.#followedRoutes.get(rememberedKey) ?? this.#lastReadyRoute)
        : preserveRoute
          ? this.#lastReadyRoute
          : undefined;
    const socket = this.#socket;
    const hadConnection = Boolean(
      socket || this.#clientId || this.#followedRoutes.size > 0,
    );
    this.#socket = undefined;
    this.#clientId = undefined;
    this.#selectionSourceClientId = undefined;
    this.#selectionTransitions.clear();
    this.#clearPendingLocalCheck();
    if (this.#selectionClearTimer) {
      clearTimeout(this.#selectionClearTimer);
      this.#selectionClearTimer = undefined;
    }
    this.#selectionResolving = false;
    this.#decoder.reset();
    this.#activeRouteKey = undefined;
    this.#pendingRouteKey = undefined;
    this.#followedRoutes.clear();
    this.#followerTargets.clear();
    this.#snapshotRoutes.clear();
    this.#lastReadyRoute = undefined;
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

  #setFollower(
    route: { hostId: string; threadId: string } | undefined,
    following: boolean,
    targetClientId?: string,
  ): void {
    if (!route) return;
    const key = this.#routeKey(route.hostId, route.threadId);
    if (following) {
      if (this.#followerTargets.has(key)) {
        const previousTarget = this.#followerTargets.get(key);
        if (previousTarget === targetClientId) return;
        this.#setFollower(route, false);
      }
      const sent = this.#broadcast(
        "thread-stream-following-changed",
        1,
        {
          conversationId: route.threadId,
          hostId: route.hostId,
          following,
        },
        targetClientId ? [targetClientId] : undefined,
      );
      if (sent) {
        this.#followerTargets.set(key, targetClientId);
        this.#snapshotRoutes.add(key);
      }
      return;
    } else {
      this.#snapshotRoutes.delete(key);
      if (!this.#followerTargets.has(key)) return;
      targetClientId = this.#followerTargets.get(key);
      this.#followerTargets.delete(key);
    }
    this.#broadcast(
      "thread-stream-following-changed",
      1,
      {
        conversationId: route.threadId,
        hostId: route.hostId,
        following,
      },
      targetClientId ? [targetClientId] : undefined,
    );
  }

  #requestThreadStatus(route: { hostId: string; threadId: string }): void {
    const key = this.#routeKey(route.hostId, route.threadId);
    if (this.#snapshotRoutes.has(key)) return;
    const sent = this.#broadcast(
      "thread-stream-following-status-requested",
      1,
      {
        conversationId: route.threadId,
        hostId: route.hostId,
      },
    );
    if (sent) this.#snapshotRoutes.add(key);
  }

  #handleRemoteState(message: Record<string, unknown>): void {
    const params = message.params as
      | { change?: unknown; conversationId?: unknown; hostId?: unknown }
      | undefined;
    if (
      typeof params?.conversationId !== "string" ||
      !THREAD_ID.test(params.conversationId) ||
      typeof params.hostId !== "string" ||
      typeof message.sourceClientId !== "string" ||
      !params.change ||
      typeof params.change !== "object"
    )
      return;
    const key = this.#routeKey(params.hostId, params.conversationId);
    if (!this.#followedRoutes.has(key) && key !== this.#activeRouteKey) return;
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
        sideConversation?: unknown;
        sideConversationParentNavigationPath?: unknown;
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
      const latestModel = isStateValue(state.latestModel)
        ? state.latestModel
        : undefined;
      const latestReasoningEffort = isStateValue(state.latestReasoningEffort)
        ? state.latestReasoningEffort
        : undefined;
      const threadSettingsModel = isStateValue(settings?.model)
        ? settings.model
        : undefined;
      const threadSettingsEffort = isStateValue(settings?.effort)
        ? settings.effort
        : isStateValue(settings?.reasoningEffort)
          ? settings.reasoningEffort
          : undefined;
      const model = threadSettingsModel ?? latestModel;
      const effort = threadSettingsEffort ?? latestReasoningEffort;
      if (isStateValue(model) && isStateValue(effort)) {
        const parentRoute =
          state.sideConversation === true
            ? this.#parentRoute(state.sideConversationParentNavigationPath)
            : undefined;
        const previous = this.#remoteStates.get(key);
        const next = {
          effort,
          hostId: params.hostId,
          latestModel,
          latestReasoningEffort,
          model,
          parentRoute,
          relayClientId: message.sourceClientId,
          sideConversation: state.sideConversation === true,
          threadSettingsEffort,
          threadSettingsModel,
          threadId: params.conversationId,
        };
        this.#remoteStates.set(key, next);
        const pendingRoute = this.#pendingRouteKey === key;
        const activeSideRoute =
          next.sideConversation && this.#activeRouteKey === key;
        let selectedRoute = {
          hostId: params.hostId,
          threadId: params.conversationId,
        };
        if (next.sideConversation) {
          if (!next.parentRoute) {
            this.#setFollower(
              { hostId: params.hostId, threadId: params.conversationId },
              false,
            );
            this.#followedRoutes.delete(key);
            this.#remoteStates.delete(key);
            if (pendingRoute || activeSideRoute) {
              if (this.#lastReadyRoute) this.#selectRoute(this.#lastReadyRoute);
              else this.#beginNavigation();
            }
            return;
          }
          selectedRoute = next.parentRoute;
          this.#setFollower(
            { hostId: params.hostId, threadId: params.conversationId },
            false,
          );
          this.#followedRoutes.delete(key);
          this.#remoteStates.delete(key);
        }
        if (pendingRoute || activeSideRoute) {
          this.#selectRoute(selectedRoute);
          if (selectedRoute.hostId !== "local")
            this.#setFollower(selectedRoute, true, message.sourceClientId);
          return;
        }
        if (this.#activeRouteKey === key)
          this.#setFollower(selectedRoute, true, message.sourceClientId);
        if (
          this.#activeRouteKey === key &&
          (!previous ||
            previous.model !== next.model ||
            previous.effort !== next.effort ||
            previous.relayClientId !== next.relayClientId ||
            previous.sideConversation !== next.sideConversation ||
            previous.parentRoute?.hostId !== next.parentRoute?.hostId ||
            previous.parentRoute?.threadId !== next.parentRoute?.threadId)
        )
          this.#emitChange();
      }
      return;
    }

    if (change.type !== "patches" || !Array.isArray(change.patches)) return;
    const current = this.#remoteStates.get(key);
    if (!current || current.relayClientId !== message.sourceClientId) return;
    let latestModel = current.latestModel;
    let latestReasoningEffort = current.latestReasoningEffort;
    let threadSettingsModel = current.threadSettingsModel;
    let threadSettingsEffort = current.threadSettingsEffort;
    for (const patch of change.patches) {
      if (!patch || typeof patch !== "object") continue;
      const { path: patchPath, value } = patch as {
        path?: unknown;
        value?: unknown;
      };
      if (!Array.isArray(patchPath) || patchPath.length === 0) continue;
      if (patchPath[0] === "latestModel")
        latestModel = isStateValue(value) ? value : undefined;
      if (patchPath[0] === "latestReasoningEffort")
        latestReasoningEffort = isStateValue(value) ? value : undefined;
      if (patchPath[0] === "latestThreadSettings" && patchPath.length === 1) {
        const settings =
          value && typeof value === "object"
            ? (value as {
                effort?: unknown;
                model?: unknown;
                reasoningEffort?: unknown;
              })
            : undefined;
        threadSettingsModel = isStateValue(settings?.model)
          ? settings.model
          : undefined;
        threadSettingsEffort = isStateValue(settings?.effort)
          ? settings.effort
          : isStateValue(settings?.reasoningEffort)
            ? settings.reasoningEffort
            : undefined;
      }
      if (
        patchPath[0] === "latestThreadSettings" &&
        patchPath[1] === "model" &&
        patchPath.length > 1
      )
        threadSettingsModel = isStateValue(value) ? value : undefined;
      if (
        patchPath[0] === "latestThreadSettings" &&
        ["effort", "reasoningEffort"].includes(String(patchPath[1])) &&
        patchPath.length > 1
      )
        threadSettingsEffort = isStateValue(value) ? value : undefined;
    }
    const model = threadSettingsModel ?? latestModel ?? current.model;
    const effort =
      threadSettingsEffort ?? latestReasoningEffort ?? current.effort;
    const displayChanged = model !== current.model || effort !== current.effort;
    if (
      displayChanged ||
      latestModel !== current.latestModel ||
      latestReasoningEffort !== current.latestReasoningEffort ||
      threadSettingsModel !== current.threadSettingsModel ||
      threadSettingsEffort !== current.threadSettingsEffort
    ) {
      this.#remoteStates.set(key, {
        ...current,
        effort,
        latestModel,
        latestReasoningEffort,
        model,
        threadSettingsEffort,
        threadSettingsModel,
      });
      if (displayChanged && this.#activeRouteKey === key) this.#emitChange();
    }
  }

  #routeKey(hostId: string, threadId: string): string {
    return `${hostId}\0${threadId}`;
  }

  #schedulePendingLocalCheck(key: string): void {
    const route = this.#followedRoutes.get(key);
    if (route?.hostId !== "local") return;
    this.#clearPendingLocalCheck();
    this.#pendingLocalCheckTimer = setTimeout(() => {
      this.#pendingLocalCheckTimer = undefined;
      if (this.#pendingRouteKey !== key) return;
      if (!this.#resolvePendingLocalRoute())
        this.#schedulePendingLocalCheck(key);
    }, 100);
    this.#pendingLocalCheckTimer.unref();
  }

  #resolvePendingLocalRoute(): boolean {
    const key = this.#pendingRouteKey;
    const route = key ? this.#followedRoutes.get(key) : undefined;
    if (
      !key ||
      !route ||
      route.hostId !== "local" ||
      !this.#readLocalState(route.threadId)
    )
      return false;
    this.#setFollower(route, false);
    this.#remoteStates.delete(key);
    this.#selectRoute(route);
    return true;
  }

  #refreshActiveLocalState(): void {
    const key = this.#activeRouteKey;
    if (!key) return;
    const route = this.#followedRoutes.get(key);
    if (route?.hostId !== "local") return;
    const stored = this.#readLocalState(route.threadId);
    const live = this.#remoteStates.get(key);
    if (
      !stored ||
      !live ||
      (stored.model === live.model && stored.effort === live.effort)
    )
      return;
    this.#remoteStates.set(key, {
      ...live,
      effort: stored.effort,
      model: stored.model,
    });
  }

  #clearPendingLocalCheck(): void {
    if (!this.#pendingLocalCheckTimer) return;
    clearTimeout(this.#pendingLocalCheckTimer);
    this.#pendingLocalCheckTimer = undefined;
  }

  #parentRoute(value: unknown): CodexRoute | undefined {
    if (typeof value !== "string") return undefined;
    try {
      const location = new URL(value, "codex://desktop");
      const segments = location.pathname.split("/").filter(Boolean);
      const threadId = segments.at(-1);
      const hostId =
        location.searchParams.get("hostId") ??
        (segments.at(-2) === "local" ? "local" : undefined);
      return sanitizeCodexRoute({ hostId, threadId });
    } catch {
      return undefined;
    }
  }
}
