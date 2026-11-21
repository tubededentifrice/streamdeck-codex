import { describe, expect, it } from "vitest";

import {
  addToCatalog,
  catalogValuesOf,
  emptyCatalog,
  mergeCatalog,
  sanitizeCatalog,
} from "../src/domain/catalog";
import {
  cycleChoices,
  defaultsFor,
  displayChoice,
  nextChoice,
} from "../src/domain/settings";
import { T3ModelNames } from "../src/t3code/model-names";

describe("value catalog", () => {
  it("adds new models and thinking levels once", () => {
    const first = addToCatalog(emptyCatalog(), {
      efforts: [{ effort: "high" }],
      models: [{ label: "Sol", model: "gpt-6.2-sol" }],
    });
    expect(first).toEqual({
      efforts: [{ effort: "high", label: "High", revision: 2 }],
      models: [{ label: "Sol", model: "gpt-6.2-sol", revision: 1 }],
      revision: 2,
    });
    expect(
      addToCatalog(first!, {
        efforts: [{ effort: "HIGH" }],
        models: [{ model: "GPT-6.2-Sol" }],
      }),
    ).toBeUndefined();
  });

  it("rejects invalid values", () => {
    expect(
      addToCatalog(emptyCatalog(), {
        efforts: [{ effort: "" }],
        models: [{ model: "bad model id" }],
      }),
    ).toBeUndefined();
    expect(
      sanitizeCatalog({ models: [{ model: "x y" }], revision: -1 }),
    ).toEqual(emptyCatalog());
  });

  it("links preset values to Model and Thinking keys as disabled values", () => {
    const preset = {
      presets: [{ effort: "xhigh", label: "Sol", model: "gpt-6.2-sol" }],
    };
    const catalog = addToCatalog(
      emptyCatalog(),
      catalogValuesOf("preset", preset),
    )!;

    const model = mergeCatalog("model", defaultsFor("model"), catalog)!;
    expect(model.models?.at(-1)).toMatchObject({
      enabled: false,
      label: "Sol",
      model: "gpt-6.2-sol",
    });
    expect(model.catalogRevision).toBe(catalog.revision);

    const thinking = mergeCatalog(
      "thinking",
      defaultsFor("thinking"),
      catalog,
    )!;
    expect(thinking.thinking?.at(-1)).toMatchObject({
      effort: "xhigh",
      enabled: false,
    });
    expect(mergeCatalog("preset", preset, catalog)?.presets).toEqual(
      preset.presets,
    );
  });

  it("does not add a value twice or bring back a removed value", () => {
    const catalog = addToCatalog(emptyCatalog(), {
      models: [{ model: "gpt-5.6-sol" }, { model: "gpt-6.2-sol" }],
    })!;
    const merged = mergeCatalog("model", defaultsFor("model"), catalog)!;
    expect(
      merged.models?.filter((choice) => choice.model === "gpt-5.6-sol"),
    ).toHaveLength(1);

    const removed = {
      ...merged,
      models: merged.models?.filter((choice) => choice.model !== "gpt-6.2-sol"),
    };
    expect(mergeCatalog("model", removed, catalog)).toBeUndefined();
  });
});

describe("disabled values", () => {
  const settings = {
    models: [
      { label: "Sol", model: "gpt-6.2-sol" },
      { enabled: false, label: "Opus", model: "claude-opus-5-5" },
      { label: "Luna", model: "gpt-6-luna" },
    ],
  };
  const state = {
    effort: "high",
    hostId: "t3code:draft",
    threadId: "6fc9b847-da70-48da-a4c1-24ab629ecd4d",
  };

  it("skips a disabled value in the cycle", () => {
    expect(
      cycleChoices("model", settings).map(
        (c) => (c as { model: string }).model,
      ),
    ).toEqual(["gpt-6.2-sol", "gpt-6-luna"]);
    expect(
      nextChoice("model", settings, { ...state, model: "gpt-6.2-sol" })?.model,
    ).toBe("gpt-6-luna");
  });

  it("still recognizes a disabled value", () => {
    const current = { ...state, model: "claude-opus-5-5" };
    expect(displayChoice("model", settings, current)?.label).toBe("Opus");
    expect(nextChoice("model", settings, current)?.model).toBe("gpt-6.2-sol");
  });
});

describe("T3 Code model names", () => {
  it("maps picker names to model ids", () => {
    const names = new T3ModelNames({
      directory: "/caches",
      readDirectory: () => ["claudeAgent.json", "notes.txt", "broken.json"],
      readText: (file) =>
        file.endsWith("broken.json")
          ? "{"
          : JSON.stringify({
              models: [{ name: "Claude Opus 5.5", slug: "claude-opus-5-5" }],
            }),
    });

    expect(names.idFor("Claude Opus 5.5")).toBe("claude-opus-5-5");
    expect(names.idFor("Unknown Model")).toBe("Unknown Model");
  });
});
