import { describe, expect, it, vi } from "vitest";

import type {
  ComposerPage,
  FrontAppSnapshot,
} from "../src/apps/front-app-watcher";
import { ChatGPTClient } from "../src/chatgpt/client";
import { ChatGPTModelNames } from "../src/chatgpt/model-names";
import { CodexError } from "../src/codex/errors";

const sameName = { idFor: (name: string) => name };

type Fields = Partial<
  Pick<FrontAppSnapshot, "accessibility" | "started"> & ComposerPage
>;

function snapshotFrom(fields: Fields, base?: FrontAppSnapshot) {
  const page = base?.chatgpt ?? {
    composer: "GPT-6.2 Sol High",
    index: 0,
    route: "Upgrade",
  };
  const { accessibility, started, ...pageFields } = fields;
  return {
    accessibility: accessibility ?? base?.accessibility ?? true,
    app: "chatgpt",
    chatgpt: { ...page, ...pageFields },
    started: started ?? base?.started ?? true,
    t3code: { composer: undefined, index: 0, route: undefined },
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

describe("ChatGPT client", () => {
  it("reads the chat from the model button", async () => {
    const client = new ChatGPTClient(watcher(), vi.fn(), sameName);

    await expect(client.readState()).resolves.toEqual({
      effort: "high",
      hostId: "chatgpt",
      model: "GPT-6.2 Sol",
      threadId: "Upgrade",
    });
  });

  it.each([
    [{ started: false }, "resolving-task"],
    [{ accessibility: false }, "accessibility"],
    [{ route: undefined }, "resolving-task"],
    [{ composer: undefined }, "resolving-task"],
  ] as const)("reports %o as %s", async (fields, code) => {
    const client = new ChatGPTClient(watcher(fields), vi.fn(), sameName);

    const error = await client.readState().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CodexError);
    expect(error).toMatchObject({ app: "chatgpt", code });
  });

  it("changes the active composer and accepts the result it shows", async () => {
    const run = vi.fn(async () => "GPT-6.2 Sol Light");
    const client = new ChatGPTClient(watcher({ index: 1 }), run, sameName);
    const listener = vi.fn();
    client.onChange(listener);

    const state = await client.update(
      "GPT-6.2 Sol",
      "low",
      "Upgrade",
      "chatgpt",
    );

    expect(run).toHaveBeenCalledWith({
      app: "chatgpt",
      composer: 1,
      effort: "low",
      model: "GPT-6.2 Sol",
      route: "Upgrade",
    });
    expect(state).toMatchObject({ effort: "low", model: "GPT-6.2 Sol" });
    expect(listener).toHaveBeenCalled();
  });

  it("does not change a chat that is no longer open", async () => {
    const view = watcher();
    const run = vi.fn(async () => "GPT-6.2 Sol Light");
    const client = new ChatGPTClient(view, run, sameName);
    const revision = client.routeRevision;
    view.emit({ route: "5 More Minutes" });

    expect(client.routeRevision).toBe(revision + 1);
    await expect(
      client.update("GPT-6.2 Sol", "low", "Upgrade", "chatgpt"),
    ).rejects.toThrow("The selected task changed before the update.");
    expect(run).not.toHaveBeenCalled();
  });

  it("treats a focus move to the side chat as a new task", () => {
    const view = watcher();
    const client = new ChatGPTClient(view, vi.fn(), sameName);
    const revision = client.routeRevision;

    view.emit({ index: 1 });

    expect(client.routeRevision).toBe(revision + 1);
  });

  it("reports a change that ChatGPT does not show", async () => {
    vi.useFakeTimers();
    try {
      const client = new ChatGPTClient(
        watcher(),
        vi.fn(async () => "GPT-6.2 Sol High"),
        sameName,
      );
      const result = client
        .update("GPT-6.2 Sol", "low", "Upgrade", "chatgpt")
        .catch((error: unknown) => error);
      await vi.runAllTimersAsync();

      expect(await result).toEqual(
        new Error(
          "ChatGPT did not show the requested model and thinking level.",
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ChatGPT model names", () => {
  it("maps button names to the Codex model ids", () => {
    const names = new ChatGPTModelNames({
      file: "models_cache.json",
      readText: () =>
        JSON.stringify({
          models: [
            { display_name: "GPT-6.2-Sol", slug: "gpt-6.2-sol" },
            { display_name: "GPT-6.1 Terra", slug: "gpt-6.1-terra" },
            { slug: 42 },
          ],
        }),
    });

    expect(names.idFor("GPT-6.2 Sol")).toBe("gpt-6.2-sol");
    expect(names.idFor("GPT-6.1 Terra")).toBe("gpt-6.1-terra");
    expect(names.idFor("Custom")).toBe("Custom");
  });

  it("keeps the names when the model list is missing", () => {
    const names = new ChatGPTModelNames({
      readText: () => {
        throw new Error("missing");
      },
    });

    expect(names.idFor("GPT-6.2 Sol")).toBe("GPT-6.2 Sol");
  });
});
