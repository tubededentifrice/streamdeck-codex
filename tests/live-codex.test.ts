import { afterAll, describe, expect, it } from "vitest";

import { CodexDesktopClient } from "../src/codex/desktop-client";

const runLive = process.env.CODEX_LIVE_TEST === "1" ? describe : describe.skip;
const client = new CodexDesktopClient();

runLive("Codex desktop", () => {
  afterAll(() => client.disconnect());

  it("reads the selected task without changing it", async () => {
    const state = await client.readState();
    expect(state.threadId).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(state.model).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
    expect(state.effort).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
  }, 15_000);

  it("applies and verifies an idempotent update", async () => {
    const before = await client.readState();
    const after = await client.update(
      before.model,
      before.effort,
      before.threadId,
      before.hostId,
    );
    expect(after).toEqual(before);
  }, 15_000);
});
