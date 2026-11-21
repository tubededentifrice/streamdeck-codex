import { describe, expect, it, vi } from "vitest";

import type { FrontAppSnapshot } from "../src/apps/front-app-watcher";
import { CodexError } from "../src/codex/errors";
import { parseT3Route, T3CodeClient } from "../src/t3code/client";

const ENV = "412c5129-d175-4431-b1e9-1cf9dcfe2ab7";
const THREAD = "ec79e37d-c4ad-48c2-b7fd-94b46f3c6671";
const DRAFT = "6fc9b847-da70-48da-a4c1-24ab629ecd4d";

const sameName = { idFor: (name: string) => name };

function makeClient(
  view: ConstructorParameters<typeof T3CodeClient>[0],
  run: ConstructorParameters<typeof T3CodeClient>[1],
  names: ConstructorParameters<typeof T3CodeClient>[2] = sameName,
) {
  return new T3CodeClient(view, run, names);
}

function watcher(snapshot: Partial<FrontAppSnapshot> = {}) {
  const listeners = new Set<() => void>();
  return {
    emit(next: Partial<FrontAppSnapshot>) {
      this.snapshot = { ...this.snapshot, ...next };
      for (const listener of listeners) listener();
    },
    onChange: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: {
      accessibility: true,
      app: "t3code",
      started: true,
      t3Composer: "GPT-6.2-Sol, High · Standard",
      t3Url: `t3code://app/#/draft/${DRAFT}`,
      ...snapshot,
    } as FrontAppSnapshot,
  };
}

describe("T3 Code route", () => {
  it.each([
    [`t3code://app/#/${ENV}/${THREAD}`, ENV, THREAD],
    [`t3code://app/#/threads/${ENV}/${THREAD}`, ENV, THREAD],
    [
      `t3code://app/#/${ENV}/import%3Acodex%3A01a145aa-8078-7f21`,
      ENV,
      "import:codex:01a145aa-8078-7f21",
    ],
    [`t3code://app/#/draft/${DRAFT}`, undefined, DRAFT],
  ])("reads %s", (url, environmentId, threadId) => {
    expect(parseT3Route(url)).toEqual({ environmentId, threadId });
  });

  it.each([undefined, "t3code://app/#/settings", "t3code://app/#/", "x"])(
    "ignores %s",
    (url) => {
      expect(parseT3Route(url)).toBeUndefined();
    },
  );
});

describe("T3 Code client", () => {
  it("reads a new thread from the model button", async () => {
    const client = makeClient(watcher(), vi.fn());

    await expect(client.readState()).resolves.toEqual({
      effort: "high",
      hostId: "t3code:draft",
      model: "GPT-6.2-Sol",
      threadId: DRAFT,
    });
  });

  it("reads a thread in any environment", async () => {
    const client = makeClient(
      watcher({
        t3Composer: "Claude Opus 5.5, Extra High",
        t3Url: `t3code://app/#/18668344-277e-4848-8869-b4ef29ac4d09/${THREAD}`,
      }),
      vi.fn(),
    );

    await expect(client.readState()).resolves.toEqual({
      effort: "xhigh",
      hostId: "t3code:18668344-277e-4848-8869-b4ef29ac4d09",
      model: "Claude Opus 5.5",
      threadId: THREAD,
    });
  });

  it.each([
    [{ started: false }, "resolving-task"],
    [{ accessibility: false }, "accessibility"],
    [{ t3Url: "t3code://app/#/settings" }, "resolving-task"],
    [{ t3Composer: undefined }, "resolving-task"],
  ] as const)("reports %o as %s", async (snapshot, code) => {
    const client = makeClient(watcher(snapshot), vi.fn());

    const error = await client.readState().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CodexError);
    expect(error).toMatchObject({ app: "t3code", code });
  });

  it("changes the composer and accepts the result it shows", async () => {
    const run = vi.fn(async () => "Claude Opus 5.5, Medium");
    const client = makeClient(watcher(), run);
    const listener = vi.fn();
    client.onChange(listener);

    const state = await client.update(
      "claude-opus-5-5",
      "medium",
      DRAFT,
      "t3code:draft",
    );

    expect(run).toHaveBeenCalledWith({
      effort: "medium",
      model: "claude-opus-5-5",
      url: `t3code://app/#/draft/${DRAFT}`,
    });
    expect(state).toMatchObject({ effort: "medium", model: "Claude Opus 5.5" });
    expect(listener).toHaveBeenCalled();
  });

  it("waits for the model button to show the change", async () => {
    const view = watcher();
    const run = vi.fn(async () => {
      setTimeout(() => view.emit({ t3Composer: "GPT-6.2-Sol, Low" }), 150);
      return "GPT-6.2-Sol, High";
    });
    const client = makeClient(view, run);

    await expect(
      client.update("gpt-6.2-sol", "low", DRAFT, "t3code:draft"),
    ).resolves.toMatchObject({ effort: "low" });
  });

  it("reports a change that T3 Code does not show", async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient(
        watcher(),
        vi.fn(async () => "GPT-6.2-Sol, High"),
      );
      const result = client
        .update("gpt-6.2-sol", "low", DRAFT, "t3code:draft")
        .catch((error: unknown) => error);
      await vi.runAllTimersAsync();

      expect(await result).toEqual(
        new Error(
          "T3 Code did not show the requested model and thinking level.",
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not change a thread that is no longer open", async () => {
    const view = watcher();
    const run = vi.fn(async () => "GPT-6.2-Sol, Low");
    const client = makeClient(view, run);
    const revision = client.routeRevision;
    view.emit({ t3Url: `t3code://app/#/${ENV}/${THREAD}` });

    expect(client.routeRevision).toBe(revision + 1);
    await expect(
      client.update("gpt-6.2-sol", "low", DRAFT, "t3code:draft"),
    ).rejects.toThrow("The selected task changed before the update.");
    expect(run).not.toHaveBeenCalled();
  });

  it("passes a composer failure through", async () => {
    const client = makeClient(
      watcher(),
      vi.fn(async () => {
        throw new Error("T3 Code has no model gpt-0.");
      }),
    );

    await expect(
      client.update("gpt-0", "high", DRAFT, "t3code:draft"),
    ).rejects.toThrow("T3 Code has no model gpt-0.");
  });

  it("reports the model id that T3 Code uses for the picker name", async () => {
    const client = makeClient(
      watcher({ t3Composer: "Claude Opus 5.5, High" }),
      vi.fn(),
      {
        idFor: (name) =>
          name === "Claude Opus 5.5" ? "claude-opus-5-5" : name,
      },
    );

    expect((await client.readState()).model).toBe("claude-opus-5-5");
  });
});
