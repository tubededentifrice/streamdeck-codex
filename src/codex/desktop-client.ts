import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { CodexState } from "../domain/settings";
import { sanitizeCodexRoute, type CodexRoute } from "../domain/route";
import { CodexError } from "./errors";
import {
  updateRemoteTaskThroughSsh,
  validateRemoteTaskThroughSsh,
} from "./remote-app-server";

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
) => Promise<Pick<CodexState, "effort" | "model">>;

type RemoteValidator = (
  current: Pick<CodexState, "hostId">,
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
  readonly #remoteValidator: RemoteValidator;
  readonly #routeChanged: (route: CodexRoute | undefined) => void;
  readonly #listeners = new Set<() => void>();
  readonly #pending = new Map<string, PendingRequest>();
  readonly #remoteStates = new Map<
    string,
    CodexState & {
      parentRoute?: CodexRoute;
      relayClientId: string;
      sideConversation: boolean;
    }
  >();
  readonly #followedRoutes = new Map<
    string,
    { hostId: string; threadId: string }
  >();
  readonly #followerTargets = new Map<string, string | undefined>();
  #activeRouteKey: string | undefined;
  #buffer = Buffer.alloc(0);
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
    remoteUpdater: RemoteUpdater = updateRemoteTaskThroughSsh,
    routeChanged: (route: CodexRoute | undefined) => void = () => undefined,
    remoteValidator: RemoteValidator = validateRemoteTaskThroughSsh,
  ) {
    this.#codexHome = codexHome;
    this.#remoteUpdater = remoteUpdater;
    this.#routeChanged = routeChanged;
    this.#remoteValidator = remoteValidator;
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
    if (live) {
      this.#refreshFollower(route);
      return live;
    }
    if (route.hostId === "local") {
      const stored = this.#readLocalState(route.threadId);
      if (stored) {
        this.#refreshFollower(route);
        return stored;
      }
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
      const target = { effort, model };
      await this.#remoteValidator(before, target);
      const route = await this.#selectedRoute();
      if (route.threadId !== before.threadId || route.hostId !== before.hostId)
        throw new Error("The selected task changed during the update.");

      if (await this.#updateRemoteThroughOwner(before, target)) {
        const verified = await this.#waitForRemoteState(before, target);
        if (!verified)
          throw new Error(
            "Codex desktop did not confirm the remote settings update.",
          );
        this.#emitChange();
        return verified;
      }

      const updated = await this.#remoteUpdater(before, target);
      const fallbackRoute = await this.#selectedRoute();
      if (
        fallbackRoute.threadId !== before.threadId ||
        fallbackRoute.hostId !== before.hostId
      )
        throw new Error("The selected task changed during the update.");
      const key = this.#routeKey(before.hostId, before.threadId);
      const liveState = this.#remoteStates.get(key);
      if (!liveState)
        throw new Error(
          "Codex desktop did not provide the remote task owner after the update.",
        );
      this.#remoteStates.set(key, {
        ...before,
        ...updated,
        relayClientId: liveState.relayClientId,
        sideConversation: false,
      });
      this.#emitChange();
      return { ...before, ...updated };
    }

    this.#refreshFollower(before);

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
        if (restored.hostId !== "local") this.#setFollower(restored, true);
        else if (this.#pendingRouteKey) this.#requestThreadStatus(restored);
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
    this.#refreshFollower(route);
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
      this.#pending.set(requestId, { method, reject, resolve, timer });
      this.#socket?.write(encodeFrame(message));
    });
  }

  #broadcast(
    method: string,
    version: number,
    params: unknown,
    targetClientIds?: string[],
  ): void {
    if (!this.#socket || this.#socket.destroyed || !this.#clientId) return;
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
            const isNewRoute = !this.#followedRoutes.has(key);
            this.#followedRoutes.set(key, route);
            this.#setFollower(route, true, sourceClientId);
            const knownState = this.#remoteStates.get(key);
            if (
              route.hostId === "local" &&
              !knownState &&
              !this.#readLocalState(route.threadId)
            ) {
              this.#beginResolving(key);
              this.#requestThreadStatus(route);
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
            this.#setFollower(
              selectedRoute,
              true,
              knownState?.relayClientId ?? sourceClientId,
            );
            const selectedKey = this.#routeKey(
              selectedRoute.hostId,
              selectedRoute.threadId,
            );
            if (isNewRoute || !this.#remoteStates.has(selectedKey))
              this.#refreshFollower(selectedRoute);
            else this.#requestThreadStatus(selectedRoute);
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
    this.#buffer = Buffer.alloc(0);
    this.#activeRouteKey = undefined;
    this.#pendingRouteKey = undefined;
    this.#followedRoutes.clear();
    this.#followerTargets.clear();
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
        if (previousTarget !== undefined) this.#setFollower(route, false);
      }
      this.#followerTargets.set(key, targetClientId);
    } else {
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

  #refreshFollower(route: { hostId: string; threadId: string }): void {
    const key = this.#routeKey(route.hostId, route.threadId);
    if (!this.#followerTargets.has(key)) {
      this.#requestThreadStatus(route);
      return;
    }
    const targetClientId = this.#followerTargets.get(key);
    this.#broadcast(
      "thread-stream-following-changed",
      1,
      {
        conversationId: route.threadId,
        hostId: route.hostId,
        following: true,
      },
      targetClientId ? [targetClientId] : undefined,
    );
  }

  #requestThreadStatus(route: { hostId: string; threadId: string }): void {
    this.#broadcast("thread-stream-following-status-requested", 1, {
      conversationId: route.threadId,
      hostId: route.hostId,
    });
  }

  async #updateRemoteThroughOwner(
    route: Pick<CodexState, "hostId" | "threadId">,
    target: Pick<CodexState, "effort" | "model">,
  ): Promise<boolean> {
    const key = this.#routeKey(route.hostId, route.threadId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const owner = this.#remoteStates.get(key)?.relayClientId;
      if (!owner) return false;
      this.#setFollower(route, true, owner);
      try {
        const result = (await this.#request(
          "thread-follower-update-thread-settings",
          {
            conversationId: route.threadId,
            threadSettings: target,
          },
          1,
          5000,
          owner,
        )) as { ok?: unknown } | undefined;
        if (result?.ok !== true)
          throw new Error(
            "Codex desktop did not confirm the remote settings update.",
          );
        return true;
      } catch {
        if (attempt > 0) return false;
        this.#requestThreadStatus(route);
        this.#refreshFollower(route);
        await new Promise((resolve) => setTimeout(resolve, 200));
        const selected = await this.#selectedRoute();
        if (
          selected.threadId !== route.threadId ||
          selected.hostId !== route.hostId
        )
          throw new Error("The selected task changed during the update.");
        const refreshedOwner = this.#remoteStates.get(key)?.relayClientId;
        if (refreshedOwner && refreshedOwner !== owner)
          this.#setFollower(route, true, refreshedOwner);
      }
    }
    return false;
  }

  async #waitForRemoteState(
    route: Pick<CodexState, "hostId" | "threadId">,
    target: Pick<CodexState, "effort" | "model">,
  ): Promise<CodexState | undefined> {
    const key = this.#routeKey(route.hostId, route.threadId);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const selected = await this.#selectedRoute();
      if (
        selected.threadId !== route.threadId ||
        selected.hostId !== route.hostId
      )
        throw new Error("The selected task changed during the update.");
      const state = this.#remoteStates.get(key);
      if (state?.model === target.model && state.effort === target.effort)
        return {
          effort: state.effort,
          hostId: state.hostId,
          model: state.model,
          threadId: state.threadId,
        };
      this.#refreshFollower(route);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return undefined;
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
      const model = isStateValue(state.latestModel)
        ? state.latestModel
        : settings?.model;
      const effort = isStateValue(state.latestReasoningEffort)
        ? state.latestReasoningEffort
        : isStateValue(settings?.effort)
          ? settings.effort
          : settings?.reasoningEffort;
      if (isStateValue(model) && isStateValue(effort)) {
        const parentRoute =
          state.sideConversation === true
            ? this.#parentRoute(state.sideConversationParentNavigationPath)
            : undefined;
        const previous = this.#remoteStates.get(key);
        const next = {
          effort,
          hostId: params.hostId,
          model,
          parentRoute,
          relayClientId: message.sourceClientId,
          sideConversation: state.sideConversation === true,
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
        }
        if (pendingRoute || activeSideRoute) {
          this.#selectRoute(selectedRoute);
          this.#setFollower(selectedRoute, true, message.sourceClientId);
          this.#refreshFollower(selectedRoute);
          return;
        }
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
      if (
        patchPath[0] === "latestThreadSettings" &&
        patchPath[1] === "model" &&
        isStateValue(value)
      )
        model = value;
      if (
        patchPath[0] === "latestThreadSettings" &&
        ["effort", "reasoningEffort"].includes(String(patchPath[1])) &&
        isStateValue(value)
      )
        effort = value;
    }
    if (model !== current.model || effort !== current.effort) {
      this.#remoteStates.set(key, { ...current, effort, model });
      if (this.#activeRouteKey === key) this.#emitChange();
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
      !route ||
      route.hostId !== "local" ||
      !this.#readLocalState(route.threadId)
    )
      return false;
    this.#selectRoute(route);
    this.#refreshFollower(route);
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
