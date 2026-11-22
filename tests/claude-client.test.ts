import { describe, expect, it, vi } from "vitest";

import type {
  ComposerPage,
  FrontAppSnapshot,
} from "../src/apps/front-app-watcher";
import { ClaudeClient } from "../src/claude/client";
import { CodexError } from "../src/codex/errors";

const ROUTE =
  "https://claude.ai/epitaxy/local_c7661ffa-9528-44f3-9751-f373f0b3c28d";
const THREAD = "/epitaxy/local_c7661ffa-9528-44f3-9751-f373f0b3c28d";

type Fields = Partial<
  Pick<FrontAppSnapshot, "accessibility" | "started"> & ComposerPage
>;

function snapshotFrom(fields: Fields, base?: FrontAppSnapshot) {
  const page = base?.claude ?? {
    composer: "Opus 5.5, High",
    index: 0,
    route: ROUTE,
  };
  const { accessibility, started, ...pageFields } = fields;
  const empty = { composer: undefined, index: 0, route: undefined };
  return {
    accessibility: accessibility ?? base?.accessibility ?? true,
    app: "claude",
    chatgpt: empty,
    claude: { ...page, ...pageFields },
    started: started ?? base?.started ?? true,
    t3code: empty,
  } as FrontAppSnapshot;
}

function watcher(fields: Fields = {}) {
  const listeners = new Set<() => void>();
  return {
    emit(next: Fields) {
      this.snapshot = snapshotFrom(next, this.snapshot);
      for (const listener of listeners) listener();
    },
    onChange: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: snapshotFrom(fields),
  };
}

describe("Claude client", () => {
  it("reads the session from the model button", async () => {
    const client = new ClaudeClient(watcher(), vi.fn());

    await expect(client.readState()).resolves.toEqual({
      effort: "high",
      hostId: "claude",
      model: "claude-opus-5-5",
      threadId: THREAD,
    });
  });

  it("reads a model without an effort choice", async () => {
    const client = new ClaudeClient(watcher({ composer: "Opus 4.5" }), vi.fn());

    await expect(client.readState()).resolves.toMatchObject({
      effort: "default",
      model: "claude-opus-4-5",
    });
  });

  it.each([
    [{ started: false }, "resolving-task"],
    [{ accessibility: false }, "accessibility"],
    [{ route: undefined }, "resolving-task"],
    [{ composer: undefined }, "resolving-task"],
  ] as const)("reports %o as %s", async (fields, code) => {
    const client = new ClaudeClient(watcher(fields), vi.fn());

    const error = await client.readState().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CodexError);
    expect(error).toMatchObject({ app: "claude", code });
  });

  it("changes the active composer and accepts the result it shows", async () => {
    const run = vi.fn(async () => "Sonnet 5.5, Extra");
    const client = new ClaudeClient(watcher({ index: 1 }), run);
    const listener = vi.fn();
    client.onChange(listener);

    const state = await client.update(
      "claude-sonnet-5-5",
      "xhigh",
      THREAD,
      "claude",
    );

    expect(run).toHaveBeenCalledWith({
      app: "claude",
      composer: 1,
      effort: "xhigh",
      model: "claude-sonnet-5-5",
      route: ROUTE,
    });
    expect(state).toMatchObject({
      effort: "xhigh",
      model: "claude-sonnet-5-5",
    });
    expect(listener).toHaveBeenCalled();
  });

  it("keeps the Claude effort for a request without one", async () => {
    const client = new ClaudeClient(
      watcher({ composer: "Opus 4.5" }),
      vi.fn(async () => "Opus 5.5, High"),
    );

    await expect(
      client.update("opus-5.5", "default", THREAD, "claude"),
    ).resolves.toMatchObject({ effort: "high", model: "claude-opus-5-5" });
  });

  it("does not change a session that is no longer open", async () => {
    const view = watcher();
    const run = vi.fn(async () => "Opus 5.5, Low");
    const client = new ClaudeClient(view, run);
    const revision = client.routeRevision;
    view.emit({ route: "https://claude.ai/new" });

    expect(client.routeRevision).toBe(revision + 1);
    await expect(
      client.update("claude-opus-5-5", "low", THREAD, "claude"),
    ).rejects.toThrow("The selected task changed before the update.");
    expect(run).not.toHaveBeenCalled();
  });

  it("reports a change that Claude does not show", async () => {
    vi.useFakeTimers();
    try {
      const client = new ClaudeClient(
        watcher(),
        vi.fn(async () => "Opus 5.5, High"),
      );
      const result = client
        .update("claude-opus-5-5", "low", THREAD, "claude")
        .catch((error: unknown) => error);
      await vi.runAllTimersAsync();

      expect(await result).toEqual(
        new Error(
          "Claude did not show the requested model and thinking level.",
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
