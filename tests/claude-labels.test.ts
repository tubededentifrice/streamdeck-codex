import { describe, expect, it } from "vitest";

import { FRONT_APP_SCRIPT } from "../src/apps/front-app-script";
import {
  claudeButtonLabel,
  claudeEffort,
  claudeModelId,
  claudeModelMatches,
  parseClaudeLabel,
} from "../src/claude/labels";

describe("Claude labels", () => {
  it.each([
    ["Low", "low"],
    ["Medium Recommended", "medium"],
    ["High", "high"],
    ["Extra", "xhigh"],
    ["Max 3.5× or more usage", "max"],
    ["Ultracode", "ultracode"],
    [" ", undefined],
  ])("reads the %s effort", (label, effort) => {
    expect(claudeEffort(label)).toBe(effort);
  });

  it.each([
    ["Model: Opus 5.5 High", ["Opus 5.5", " ", "High"], "Opus 5.5, High"],
    [
      "Model: Opus 5.5 Max 3.5× or more usage",
      ["Opus 5.5", " ", "Max", ""],
      "Opus 5.5, Max",
    ],
    ["Model: Opus 4.5", [], "Opus 4.5"],
    ["Model: Haiku 4.5", ["Haiku 4.5"], "Haiku 4.5"],
    ["Model: ", [], undefined],
  ])("builds the label of the %s button", (title, texts, label) => {
    expect(claudeButtonLabel(title, texts)).toBe(label);
  });

  it.each([
    ["Opus 5.5, High", { effort: "high", model: "Opus 5.5" }],
    ["Opus 5.5, Extra", { effort: "xhigh", model: "Opus 5.5" }],
    ["Opus 4.5", { effort: undefined, model: "Opus 4.5" }],
  ])("reads the %s label", (label, expected) => {
    expect(parseClaudeLabel(label)).toEqual(expected);
  });

  it("reads no model from an empty label", () => {
    expect(parseClaudeLabel(" ")).toBeUndefined();
  });

  it.each([
    ["Opus 5.5", "claude-opus-5-5", true],
    ["Opus 5.5 For complex work and everyday tasks", "claude-opus-5-5", true],
    ["Opus 5.5", "opus-5.5", true],
    ["claude-opus-5-5", "Opus 5.5", true],
    ["Opus 5.5 For complex work", "claude-opus-5", false],
    ["Opus 5", "claude-opus-5-5", false],
    ["Sonnet 5.5", "claude-opus-5-5", false],
    ["Opus 5.5", "", false],
  ])("matches %s with %s: %s", (title, model, expected) => {
    expect(claudeModelMatches(title, model)).toBe(expected);
  });

  it.each([
    ["Opus 5.5", "claude-opus-5-5"],
    ["Fable 5.2", "claude-fable-5-2"],
    ["Sonnet 5", "claude-sonnet-5"],
    ["claude-haiku-4-5", "claude-haiku-4-5"],
  ])("maps %s to %s", (name, id) => {
    expect(claudeModelId(name)).toBe(id);
  });

  it("builds JXA programs that parse", () => {
    expect(() => new Function(FRONT_APP_SCRIPT)).not.toThrow();
    expect(FRONT_APP_SCRIPT).toContain("const claudeModelMatches = function");
    expect(FRONT_APP_SCRIPT).toContain("function applyClaude(");
    expect(FRONT_APP_SCRIPT).toContain("function toggleClaudePanel(");
  });
});
