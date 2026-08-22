import { describe, expect, it } from "vitest";

import {
  choicesFor,
  defaultsFor,
  nextChoice,
  targetState,
  type CodexState,
} from "../src/domain/settings";

const current: CodexState = {
  effort: "medium",
  model: "gpt-5.6-sol",
  threadId: "thread-123",
};

describe("choice settings", () => {
  it("uses useful defaults for each action", () => {
    expect(choicesFor("model", defaultsFor("model"))).toHaveLength(2);
    expect(choicesFor("thinking", defaultsFor("thinking"))).toHaveLength(2);
    expect(choicesFor("preset", defaultsFor("preset"))).toHaveLength(2);
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
});
