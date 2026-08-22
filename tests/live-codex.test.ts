import { afterAll, describe, expect, it } from "vitest";

import { CodexDesktopClient } from "../src/codex/desktop-client";

const runLive = process.env.CODEX_LIVE_TEST === "1" ? describe : describe.skip;
const client = new CodexDesktopClient();
if (process.env.CODEX_LIVE_THREAD_ID && process.env.CODEX_LIVE_HOST_ID) {
  client.restoreRoute({
    hostId: process.env.CODEX_LIVE_HOST_ID,
    threadId: process.env.CODEX_LIVE_THREAD_ID,
  });
}

runLive("Codex desktop", () => {
  afterAll(() => client.disconnect());

  it("reads the selected task without changing it", async () => {
    const state = await client.readState();
    expect(state.threadId).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(state.model).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
    expect(state.effort).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
    if (process.env.CODEX_LIVE_THREAD_ID)
      expect(state.threadId).toBe(process.env.CODEX_LIVE_THREAD_ID);
    if (process.env.CODEX_LIVE_HOST_ID)
      expect(state.hostId).toBe(process.env.CODEX_LIVE_HOST_ID);
  }, 15_000);

  it("applies and verifies an update", async () => {
    const before = await client.readState();
    const model = process.env.CODEX_LIVE_TARGET_MODEL ?? before.model;
    const effort = process.env.CODEX_LIVE_TARGET_EFFORT ?? before.effort;
    const after = await client.update(
      model,
      effort,
      before.threadId,
      before.hostId,
    );
    expect(after).toEqual({ ...before, effort, model });
  }, 60_000);
});
