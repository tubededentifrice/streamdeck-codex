#!/usr/bin/env node
/* global Buffer, process, setTimeout */

import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const MAX_FRAME_SIZE = 16 * 1024 * 1024;
const socketPath = path.join(
  process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  "ipc",
  "ipc.sock",
);
const info = fs.lstatSync(socketPath);
if (!info.isSocket() || (info.mode & 0o077) !== 0)
  throw new Error("Codex IPC is not an owner-only socket.");
if (typeof process.getuid === "function" && info.uid !== process.getuid())
  throw new Error("Codex IPC has a different owner.");

function frame(value) {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

function safeSummary(message) {
  const params =
    message.params && typeof message.params === "object"
      ? message.params
      : undefined;
  const allowed = [
    "conversationId",
    "threadId",
    "model",
    "effort",
    "reasoningEffort",
    "following",
    "status",
    "kind",
    "type",
    "host",
    "hostId",
    "hostname",
    "connectionId",
  ];
  const values = {};
  for (const key of allowed) {
    const value = params?.[key];
    if (["string", "number", "boolean"].includes(typeof value))
      values[key] = value;
  }
  const change = params?.change;
  const conversationState =
    change &&
    typeof change === "object" &&
    change.conversationState &&
    typeof change.conversationState === "object"
      ? change.conversationState
      : undefined;
  const latestThreadSettings =
    conversationState?.latestThreadSettings &&
    typeof conversationState.latestThreadSettings === "object"
      ? conversationState.latestThreadSettings
      : undefined;
  return {
    type: message.type,
    method: message.method,
    sourceClientId: message.sourceClientId,
    version: message.version,
    resultType: message.resultType,
    handledByClientId: message.handledByClientId,
    paramKeys: params ? Object.keys(params).sort() : [],
    values,
    changeType:
      change && typeof change === "object" && typeof change.type === "string"
        ? change.type
        : undefined,
    conversationStateKeys: conversationState
      ? Object.keys(conversationState).sort()
      : [],
    threadSettings: latestThreadSettings
      ? {
          model: latestThreadSettings.model,
          effort: latestThreadSettings.effort,
          reasoningEffort: latestThreadSettings.reasoningEffort,
        }
      : undefined,
    latestModel: conversationState?.latestModel,
    latestReasoningEffort: conversationState?.latestReasoningEffort,
    error:
      typeof message.error === "string"
        ? message.error.slice(0, 300)
        : typeof message.error?.message === "string"
          ? message.error.message.slice(0, 300)
          : undefined,
  };
}

const socket = net.createConnection({ path: socketPath });
let buffer = Buffer.alloc(0);
let clientId;
const initializeId = crypto.randomUUID();
const requestedThreadId = process.argv[2];
const requestedHostId = process.argv[3];
const updateSame = process.argv[4] === "--update-same";
let updateSent = false;
let followRequested = false;
let discoveryRequestId;
let pendingSettings;

function broadcast(method, version, params) {
  socket.write(
    frame({
      type: "broadcast",
      sourceClientId: clientId,
      method,
      version,
      params,
    }),
  );
}

socket.on("connect", () => {
  socket.write(
    frame({
      type: "request",
      requestId: initializeId,
      sourceClientId: "initializing-client",
      version: 0,
      method: "initialize",
      params: { clientType: "codex-streamdeck-event-inspector" },
    }),
  );
});

socket.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (!length || length > MAX_FRAME_SIZE)
      throw new Error("Codex returned an invalid frame.");
    if (buffer.length < length + 4) return;
    const payload = buffer.subarray(4, length + 4);
    buffer = buffer.subarray(length + 4);
    const message = JSON.parse(payload.toString("utf8"));

    if (
      message.type === "response" &&
      message.requestId === initializeId &&
      message.resultType === "success"
    ) {
      clientId = message.result?.clientId;
      process.stdout.write("READY — switch to a remote Codex task now.\n");
      if (requestedThreadId && requestedHostId) {
        followRequested = true;
        broadcast("thread-stream-following-changed", 1, {
          conversationId: requestedThreadId,
          hostId: requestedHostId,
          following: true,
        });
        broadcast("thread-stream-following-status-requested", 1, {
          conversationId: requestedThreadId,
          hostId: requestedHostId,
        });
      }
    } else {
      process.stdout.write(`${JSON.stringify(safeSummary(message))}\n`);
    }

    if (
      message.method === "thread-stream-following-changed" &&
      message.sourceClientId !== clientId &&
      !followRequested &&
      message.params?.conversationId === requestedThreadId &&
      message.params?.hostId === requestedHostId &&
      message.params?.following === true
    ) {
      followRequested = true;
      updateSent = false;
      discoveryRequestId = undefined;
      pendingSettings = undefined;
      broadcast("thread-stream-following-changed", 1, {
        conversationId: requestedThreadId,
        hostId: requestedHostId,
        following: true,
      });
      broadcast("thread-stream-following-status-requested", 1, {
        conversationId: requestedThreadId,
        hostId: requestedHostId,
      });
    }

    const state = message.params?.change?.conversationState;
    const stateModel = state?.latestModel ?? state?.latestThreadSettings?.model;
    const stateEffort =
      state?.latestReasoningEffort ??
      state?.latestThreadSettings?.effort ??
      state?.latestThreadSettings?.reasoningEffort;
    if (
      updateSame &&
      !updateSent &&
      message.method === "thread-stream-state-changed" &&
      message.params?.conversationId === requestedThreadId &&
      typeof stateModel === "string" &&
      typeof stateEffort === "string"
    ) {
      updateSent = true;
      pendingSettings = {
        model: stateModel,
        effort: stateEffort,
      };
      discoveryRequestId = crypto.randomUUID();
      socket.write(
        frame({
          type: "request",
          requestId: discoveryRequestId,
          sourceClientId: clientId,
          version: 1,
          timeoutMs: 5000,
          method: "thread-owner-discovery",
          params: {
            conversationId: requestedThreadId,
            hostId: requestedHostId,
          },
        }),
      );
    }

    if (
      message.type === "response" &&
      message.requestId === discoveryRequestId &&
      message.resultType === "success" &&
      typeof message.handledByClientId === "string" &&
      pendingSettings
    ) {
      socket.write(
        frame({
          type: "request",
          requestId: crypto.randomUUID(),
          sourceClientId: clientId,
          targetClientId: message.handledByClientId,
          version: 1,
          timeoutMs: 5000,
          method: "thread-follower-update-thread-settings",
          params: {
            conversationId: requestedThreadId,
            threadSettings: pendingSettings,
          },
        }),
      );
      pendingSettings = undefined;
    }

    if (message.type === "client-discovery-request" && message.requestId) {
      socket.write(
        frame({
          type: "client-discovery-response",
          requestId: message.requestId,
          response: { canHandle: false },
          sourceClientId: clientId,
        }),
      );
    }
  }
});

socket.on("error", (error) => {
  process.stderr.write(`Listener error: ${error.message}\n`);
  process.exitCode = 1;
});

setTimeout(() => socket.end(), 5 * 60 * 1000).unref();
