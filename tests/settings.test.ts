import { describe, expect, it } from "vitest";

import {
  choicesFor,
  defaultsFor,
  displayChoice,
  nextChoice,
  targetState,
  type CodexState,
} from "../src/domain/settings";

const current: CodexState = {
  effort: "medium",
  hostId: "local",
  model: "gpt-5.6-sol",
  threadId: "thread-123",
};

describe("choice settings", () => {
  it("uses useful defaults for each action", () => {
    expect(choicesFor("model", defaultsFor("model"))).toHaveLength(2);
    expect(choicesFor("thinking", defaultsFor("thinking"))).toHaveLength(2);
    expect(choicesFor("preset", defaultsFor("preset"))).toHaveLength(2);
    expect(choicesFor("shortcut", defaultsFor("shortcut"))).toEqual([
      {
        label: "Review",
        shortcut: "review",
        styleId: "builtin:emerald",
      },
    ]);
    expect(defaultsFor("model")).toMatchObject({
      fitText: true,
      modelFontSize: 21,
      showNext: true,
      showTitle: false,
    });
    expect(defaultsFor("preset")).toMatchObject({
      modelFontSize: 21,
      thinkingFontSize: 18,
    });
    expect(defaultsFor("shortcut")).toMatchObject({
      shortcutFontSize: 18,
      showNext: false,
      showTitle: false,
    });
    expect(choicesFor("preset", defaultsFor("preset"))[0].label).toBe("Sol");
  });

  it("names a value without a label from its model id", () => {
    expect(
      choicesFor("model", {
        models: [{ label: "", model: "claude-opus-5-5" }],
      }),
    ).toEqual([{ label: "Opus 5.5", model: "claude-opus-5-5" }]);
    expect(
      choicesFor("preset", {
        presets: [{ effort: "high", label: " ", model: "glm-5-3" }],
      }),
    ).toEqual([{ effort: "high", label: "Glm 5.3", model: "glm-5-3" }]);
  });

  it("accepts each supported shortcut as the only configured command", () => {
    for (const [shortcut, label] of [
      ["review", "Review"],
      ["terminal", "Terminal"],
      ["browser", "Browser"],
      ["files", "Files"],
      ["side-chat", "Side chat"],
    ] as const) {
      expect(
        choicesFor("shortcut", {
          shortcuts: [{ label, shortcut }],
        }),
      ).toEqual([{ label, shortcut }]);
    }
  });

  it("keeps the first valid shortcut from old multi-value settings", () => {
    expect(
      choicesFor("shortcut", {
        shortcuts: [
          { label: "Bad", shortcut: "settings" as "review" },
          { label: "Shell", shortcut: "terminal" },
          { label: "Web", shortcut: "browser" },
        ],
      }),
    ).toEqual([{ label: "Shell", shortcut: "terminal" }]);
  });

  it("finds the configured label for the active value", () => {
    expect(
      displayChoice(
        "model",
        { models: [{ label: "SOL", model: "gpt-5.6-sol" }] },
        current,
      ),
    ).toEqual({ label: "SOL", model: "gpt-5.6-sol" });

    expect(
      displayChoice(
        "preset",
        {
          presets: [
            {
              effort: "high",
              label: "SOL",
              model: "gpt-5.6-sol",
            },
          ],
        },
        current,
      ),
    ).toMatchObject({ label: "SOL", model: "gpt-5.6-sol" });
  });

  it("sets the only configured value directly", () => {
    const choice = nextChoice(
      "model",
      { models: [{ label: "Luna", model: "gpt-5.6-luna" }] },
      current,
    );
    expect(choice).toEqual({ label: "Luna", model: "gpt-5.6-luna" });
    expect(targetState("model", choice!, current)).toEqual({
      effort: "medium",
      model: "gpt-5.6-luna",
    });
  });

  it("cycles in order and wraps", () => {
    const settings = {
      thinking: [
        { label: "Medium", effort: "medium" },
        { label: "High", effort: "high" },
      ],
    };
    expect(nextChoice("thinking", settings, current)?.effort).toBe("high");
    expect(
      nextChoice("thinking", settings, { ...current, effort: "high" })?.effort,
    ).toBe("medium");
  });

  it("uses the first choice when the current value is outside the list", () => {
    const settings = {
      models: [
        { label: "Luna", model: "gpt-5.6-luna" },
        { label: "Terra", model: "gpt-5.6-terra" },
      ],
    };
    expect(nextChoice("model", settings, current)?.model).toBe("gpt-5.6-luna");
  });

  it("matches a preset by both model and thinking level", () => {
    const settings = {
      presets: [
        { label: "Sol high", model: "gpt-5.6-sol", effort: "high" },
        { label: "Sol medium", model: "gpt-5.6-sol", effort: "medium" },
      ],
    };
    expect(nextChoice("preset", settings, current)?.label).toBe("Sol high");
  });

  it("rejects invalid values and limits the list", () => {
    const models = Array.from({ length: 25 }, (_, index) => ({
      label: `Model ${index}`,
      model: index === 2 ? "bad value" : `model-${index}`,
    }));
    expect(choicesFor("model", { models })).toHaveLength(19);
    expect(
      choicesFor("model", { models }).some(
        (choice) => choice.model === "bad value",
      ),
    ).toBe(false);
  });

  it("removes duplicate values so that cycling cannot get stuck", () => {
    const settings = {
      models: [
        { label: "Sol", model: "gpt-5.6-sol" },
        { label: "Sol again", model: "gpt-5.6-sol" },
        { label: "Luna", model: "gpt-5.6-luna" },
      ],
    };
    expect(choicesFor("model", settings)).toEqual([
      { label: "Sol", model: "gpt-5.6-sol" },
      { label: "Luna", model: "gpt-5.6-luna" },
    ]);
    expect(nextChoice("model", settings, current)?.model).toBe("gpt-5.6-luna");
  });

  it("keeps only the first preset of a single preset key, always on", () => {
    expect(defaultsFor("single")).toMatchObject({
      inactiveFade: 75,
      showNext: false,
      showTitle: false,
    });
    expect(choicesFor("single", defaultsFor("single"))).toEqual([
      {
        effort: "medium",
        label: "Sol",
        model: "gpt-5.6-sol",
        styleId: "builtin:ocean",
      },
    ]);
    const settings = {
      presets: [
        {
          effort: "high",
          enabled: false,
          label: "Luna",
          model: "gpt-5.6-luna",
        },
        { effort: "medium", label: "Sol", model: "gpt-5.6-sol" },
      ],
    };
    expect(choicesFor("single", settings)).toEqual([
      { effort: "high", label: "Luna", model: "gpt-5.6-luna" },
    ]);
    expect(nextChoice("single", settings, current)?.model).toBe("gpt-5.6-luna");
    expect(
      nextChoice("single", settings, {
        ...current,
        effort: "high",
        model: "gpt-5.6-luna",
      })?.model,
    ).toBe("gpt-5.6-luna");
    expect(
      choicesFor("single", {
        presets: [
          { effort: "", label: "Bad", model: "gpt-5.6-luna" },
          { effort: "medium", label: "Sol", model: "gpt-5.6-sol" },
        ],
      }),
    ).toEqual([]);
  });
});
