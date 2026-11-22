import { describe, expect, it } from "vitest";

import { modelLabel } from "../src/domain/model-label";
import { RecentModels } from "../src/domain/recent-models";

describe("model labels", () => {
  it.each([
    ["gpt-6.2-sol", "Sol 6.2"],
    ["gpt-5.1-codex-max", "Codex Max 5.1"],
    ["gpt-5", "Gpt 5"],
    ["claude-opus-5-5", "Opus 5.5"],
    ["claude-opus-4-1-20250805", "Opus 4.1"],
    ["claude-3-5-sonnet-2024-10-22", "Sonnet 3.5"],
    ["glm-5.3", "Glm 5.3"],
    ["glm-5-3", "Glm 5.3"],
    ["openai/gpt-oss-120b", "Oss 120b"],
    ["gemini-2.5-pro", "Gemini Pro 2.5"],
    ["GPT-6.2 Sol", "Sol 6.2"],
    ["o3", "O3"],
  ])("names %s as %s", (model, label) => {
    expect(modelLabel(model)).toBe(label);
  });
});

describe("recent models", () => {
  it("keeps valid model ids once, newest first", () => {
    const recent = new RecentModels();
    recent.add("gpt-5.6-sol");
    recent.add("claude-opus-5-5");
    recent.add("GPT-5.6-Sol");
    recent.add("GPT-6.2 Sol");
    recent.add("not a/valid id");
    expect(recent.list).toEqual([
      "gpt-6.2-sol",
      "GPT-5.6-Sol",
      "claude-opus-5-5",
    ]);
  });

  it("keeps at most 20 models", () => {
    const recent = new RecentModels();
    for (let index = 0; index < 25; index += 1) recent.add(`model-${index}`);
    expect(recent.list).toHaveLength(20);
    expect(recent.list[0]).toBe("model-24");
  });
});
