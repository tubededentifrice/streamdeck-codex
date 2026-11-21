import { describe, expect, it, vi } from "vitest";

import type { FrontAppSnapshot } from "../src/apps/front-app-watcher";
import { CodexError } from "../src/codex/errors";
import { parseT3Route, T3CodeClient } from "../src/t3code/client";
import type {
  T3ModelSelection,
  T3ProviderCapabilities,
} from "../src/t3code/server";

const ENV = "412c5129-d175-4431-b1e9-1cf9dcfe2ab7";
const THREAD = "ec79e37d-c4ad-48c2-b7fd-94b46f3c6671";

const PROVIDERS: T3ProviderCapabilities[] = [
  {
    models: [
      {
        id: "gpt-6.2-sol",
        options: [
          { id: "reasoningEffort", values: ["low", "medium", "high"] },
          { id: "serviceTier", values: ["default", "priority"] },
        ],
      },
    ],
    providerInstanceId: "codex",
  },
  {
    models: [
      {
        id: "claude-opus-5-5",
        options: [
          { id: "effort", values: ["low", "high", "ultrathink"] },
          { id: "fastMode", values: [false, true] },
        ],
      },
    ],
    providerInstanceId: "claudeAgent",
  },
];

function watcher(snapshot: Partial<FrontAppSnapshot> = {}) {
  const listeners = new Set<() => void>();
  const value = {
    snapshot: {
      accessibility: true,
      app: "t3code",
      started: true,
      t3Url: `t3code://app/#/${ENV}/${THREAD}`,
      ...snapshot,
    } as FrontAppSnapshot,
    onChange: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: () => {
      for (const listener of listeners) listener();
    },
  };
  return value;
}

function server(initial: T3ModelSelection) {
  let selection = initial;
  return {
    capabilities: vi.fn(async () => PROVIDERS),
    environmentId: vi.fn(async () => ENV),
    readSelection: vi.fn(async () => selection),
    writeSelection: vi.fn(async (_thread: string, next: T3ModelSelection) => {
      selection = next;
    }),
  };
}

const CODEX_SELECTION: T3ModelSelection = {
  instanceId: "codex",
  model: "gpt-6.2-sol",
  options: [
    { id: "reasoningEffort", value: "medium" },
    { id: "serviceTier", value: "priority" },
  ],
};

describe("T3 Code route", () => {
  it.each([
    [`t3code://app/#/${ENV}/${THREAD}`, THREAD],
    [`t3code://app/#/threads/${ENV}/${THREAD}`, THREAD],
    [
      `t3code://app/#/${ENV}/import%3Acodex%3A01a145aa-8078-7f21`,
      "import:codex:01a145aa-8078-7f21",
    ],
    [`t3code://app/threads/${ENV}/${THREAD}`, THREAD],
  ])("reads %s", (url, threadId) => {
    expect(parseT3Route(url)).toEqual({ environmentId: ENV, threadId });
  });

  it.each([
    undefined,
    "t3code://app/#/draft/fd4fddd1-1cc9-4c02-aeb2-2f56e7852099",
    "t3code://app/#/settings",
    "t3code://app/#/",
    "not a url",
  ])("ignores %s", (url) => {
    expect(parseT3Route(url)).toBeUndefined();
  });
});

describe("T3 Code client", () => {
  it("reads the model and thinking level of the open thread", async () => {
    const client = new T3CodeClient(watcher(), server(CODEX_SELECTION));

    await expect(client.readState()).resolves.toEqual({
      effort: "medium",
      hostId: "t3code",
      model: "gpt-6.2-sol",
      threadId: THREAD,
    });
  });

  it("reads the Claude effort option", async () => {
    const client = new T3CodeClient(
      watcher(),
      server({
        instanceId: "claudeAgent",
        model: "claude-opus-5-5",
        options: [{ id: "effort", value: "ultrathink" }],
      }),
    );

    expect((await client.readState()).effort).toBe("ultrathink");
  });

  it.each([
    [{ started: false }, "resolving-task"],
    [{ accessibility: false }, "accessibility"],
    [
      { t3Url: "t3code://app/#/draft/fd4fddd1-1cc9-4c02-aeb2-2f56e7852099" },
      "resolving-task",
    ],
    [
      {
        t3Url: `t3code://app/#/18668344-277e-4848-8869-b4ef29ac4d09/${THREAD}`,
      },
      "remote-task",
    ],
  ] as const)("reports %o as %s", async (snapshot, code) => {
    const client = new T3CodeClient(watcher(snapshot), server(CODEX_SELECTION));

    const error = await client.readState().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CodexError);
    expect(error).toMatchObject({ app: "t3code", code });
  });

  it("changes the thinking level and keeps valid options", async () => {
    const backend = server(CODEX_SELECTION);
    const client = new T3CodeClient(watcher(), backend);

    const state = await client.update("gpt-6.2-sol", "high", THREAD, "t3code");

    expect(state.effort).toBe("high");
    expect(backend.writeSelection).toHaveBeenCalledWith(THREAD, {
      instanceId: "codex",
      model: "gpt-6.2-sol",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "serviceTier", value: "priority" },
      ],
    });
  });

  it("keeps the provider of the thread", async () => {
    const backend = server(CODEX_SELECTION);
    const client = new T3CodeClient(watcher(), backend);

    await expect(
      client.update("claude-opus-5-5", "high", THREAD, "t3code"),
    ).rejects.toThrow(
      "The claude-opus-5-5 model needs another T3 Code provider.",
    );
    expect(backend.writeSelection).not.toHaveBeenCalled();
  });

  it("changes the model within the Claude provider", async () => {
    const backend = server({
      instanceId: "claudeAgent",
      model: "claude-opus-5-5",
      options: [
        { id: "effort", value: "high" },
        { id: "fastMode", value: true },
      ],
    });
    const client = new T3CodeClient(watcher(), backend);

    await client.update("claude-opus-5-5", "ultrathink", THREAD, "t3code");

    expect(backend.writeSelection).toHaveBeenCalledWith(THREAD, {
      instanceId: "claudeAgent",
      model: "claude-opus-5-5",
      options: [
        { id: "effort", value: "ultrathink" },
        { id: "fastMode", value: true },
      ],
    });
  });

  it("rejects an unknown model or thinking level", async () => {
    const backend = server(CODEX_SELECTION);
    const client = new T3CodeClient(watcher(), backend);

    await expect(
      client.update("gpt-0", "high", THREAD, "t3code"),
    ).rejects.toThrow("T3 Code has no model gpt-0.");
    await expect(
      client.update("gpt-6.2-sol", "ultra", THREAD, "t3code"),
    ).rejects.toThrow("does not support the ultra thinking choice");
    expect(backend.writeSelection).not.toHaveBeenCalled();
  });

  it("keeps the provider while it lists no models", async () => {
    const backend = server(CODEX_SELECTION);
    backend.capabilities.mockResolvedValue([
      { models: [], providerInstanceId: "codex" },
    ]);
    const client = new T3CodeClient(watcher(), backend);

    await client.update("gpt-6.3-sol", "low", THREAD, "t3code");

    expect(backend.writeSelection).toHaveBeenCalledWith(THREAD, {
      instanceId: "codex",
      model: "gpt-6.3-sol",
      options: [
        { id: "serviceTier", value: "priority" },
        { id: "reasoningEffort", value: "low" },
      ],
    });
  });

  it("does not update a thread that is no longer open", async () => {
    const view = watcher();
    const backend = server(CODEX_SELECTION);
    const client = new T3CodeClient(view, backend);
    const revision = client.routeRevision;
    view.snapshot = {
      ...view.snapshot,
      t3Url: `t3code://app/#/${ENV}/2d6f5c11-0c4a-4f0d-8f8c-f5b1a1c0e001`,
    };
    view.emit();

    expect(client.routeRevision).toBe(revision + 1);
    await expect(
      client.update("gpt-6.2-sol", "high", THREAD, "t3code"),
    ).rejects.toThrow("The selected task changed before the update.");
    expect(backend.writeSelection).not.toHaveBeenCalled();
  });

  it("fails when T3 Code does not keep the new value", async () => {
    vi.useFakeTimers();
    try {
      const backend = server(CODEX_SELECTION);
      backend.writeSelection.mockResolvedValue(undefined);
      const client = new T3CodeClient(watcher(), backend);

      const result = client
        .update("gpt-6.2-sol", "high", THREAD, "t3code")
        .catch((error: unknown) => error);
      await vi.runAllTimersAsync();

      expect(await result).toEqual(
        new Error(
          "T3 Code did not save the requested model and thinking level.",
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
