import { describe, expect, it, vi } from "vitest";

import { AgentClient } from "../src/apps/agent-client";
import type { FrontAppSnapshot } from "../src/apps/front-app-watcher";
import type { CodexState } from "../src/domain/settings";

const CODEX: CodexState = {
  effort: "medium",
  hostId: "local",
  model: "gpt-5.6-sol",
  threadId: "01a0289e-e3d3-7fc1-8774-bbc3bc4f0712",
};
const CHATGPT: CodexState = {
  effort: "high",
  hostId: "chatgpt",
  model: "gpt-6.2-sol",
  threadId: "Upgrade",
};
const T3: CodexState = {
  effort: "high",
  hostId: "t3code:draft",
  model: "claude-opus-5-5",
  threadId: "ec79e37d-c4ad-48c2-b7fd-94b46f3c6671",
};

function client(state: CodexState) {
  return {
    onChange: vi.fn(() => () => undefined),
    readState: vi.fn(async () => state),
    restoreRoute: vi.fn(),
    routeRevision: 0,
    update: vi.fn(async () => state),
  };
}

function watcher(app: FrontAppSnapshot["app"]) {
  const listeners = new Set<() => void>();
  return {
    emit(next: FrontAppSnapshot["app"]) {
      this.snapshot = { ...this.snapshot, app: next };
      for (const listener of listeners) listener();
    },
    onChange: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: {
      accessibility: true,
      app,
      chatgpt: { composer: undefined, index: 0, route: undefined },
      started: true,
      t3code: { composer: undefined, index: 0, route: undefined },
    } as FrontAppSnapshot,
  };
}

describe("agent client", () => {
  it("uses Codex until T3 Code comes to the front", async () => {
    const codex = client(CODEX);
    const t3 = client(T3);
    const view = watcher(undefined);
    const agent = new AgentClient(codex, t3, client(CHATGPT), view);

    await expect(agent.readState()).resolves.toBe(CODEX);
    const revision = agent.routeRevision;

    view.emit("t3code");
    expect(agent.routeRevision).toBe(revision + 1);
    await expect(agent.readState()).resolves.toBe(T3);

    view.emit("t3code");
    expect(agent.routeRevision).toBe(revision + 1);
  });

  it("sends each update to the app that owns the task", async () => {
    const codex = client(CODEX);
    const t3 = client(T3);
    const chatgpt = client(CHATGPT);
    const agent = new AgentClient(codex, t3, chatgpt, watcher("codex"));

    await agent.update("claude-opus-5-5", "high", T3.threadId, "t3code:draft");
    await agent.update("gpt-5.6-sol", "high", CODEX.threadId, "local");
    await agent.update("gpt-6.2-sol", "low", "Upgrade", "chatgpt");

    expect(t3.update).toHaveBeenCalledWith(
      "claude-opus-5-5",
      "high",
      T3.threadId,
      "t3code:draft",
    );
    expect(codex.update).toHaveBeenCalledWith(
      "gpt-5.6-sol",
      "high",
      CODEX.threadId,
      "local",
    );
    expect(codex.update).toHaveBeenCalledOnce();
    expect(chatgpt.update).toHaveBeenCalledWith(
      "gpt-6.2-sol",
      "low",
      "Upgrade",
      "chatgpt",
    );
  });

  it("reads ChatGPT when ChatGPT comes to the front", async () => {
    const view = watcher("codex");
    const agent = new AgentClient(
      client(CODEX),
      client(T3),
      client(CHATGPT),
      view,
    );

    await expect(agent.readState()).resolves.toBe(CODEX);
    view.emit("chatgpt");
    await expect(agent.readState()).resolves.toBe(CHATGPT);
    view.emit("t3code");
    await expect(agent.readState()).resolves.toBe(T3);
  });

  it("restores only the Codex route", () => {
    const codex = client(CODEX);
    const agent = new AgentClient(
      codex,
      client(T3),
      client(CHATGPT),
      watcher(undefined),
    );

    agent.restoreRoute({ hostId: "local", threadId: CODEX.threadId });

    expect(codex.restoreRoute).toHaveBeenCalledOnce();
  });
});
