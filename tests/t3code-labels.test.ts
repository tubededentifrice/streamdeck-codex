import { describe, expect, it } from "vitest";

import { FRONT_APP_SCRIPT } from "../src/apps/front-app-script";
import { sameEffort, sameModel } from "../src/domain/settings";
import { COMPOSER_SCRIPT } from "../src/t3code/composer-script";
import {
  effortFromLabel,
  normalizeLabel,
  parseComposerLabel,
} from "../src/t3code/labels";

describe("T3 Code labels", () => {
  it.each([
    ["GPT-6.2-Sol", "gpt-6.2-sol"],
    ["Claude Opus 5.5", "claude-opus-5-5"],
    ["glm-5.3", "glm-5.3"],
  ])("matches the %s label with the %s model", (label, model) => {
    expect(normalizeLabel(label)).toBe(normalizeLabel(model));
    expect(sameModel(label, model)).toBe(true);
  });

  it("does not match different models", () => {
    expect(sameModel("GPT-6.2-Sol", "gpt-6.2-astra")).toBe(false);
  });

  it.each([
    ["Low Default", "low"],
    ["Medium", "medium"],
    ["Extra High", "xhigh"],
    ["Max", "max"],
  ])("reads the %s thinking label", (label, effort) => {
    expect(effortFromLabel(label)).toBe(effort);
    expect(sameEffort(effortFromLabel(label), effort)).toBe(true);
  });

  it.each([
    [
      "GPT-6.2-Sol, High · Standard",
      { effortLabel: "High", model: "GPT-6.2-Sol" },
    ],
    [
      "Claude Opus 5.5, Extra High",
      { effortLabel: "Extra High", model: "Claude Opus 5.5" },
    ],
    ["Grok Build", { effortLabel: undefined, model: "Grok Build" }],
    ["", undefined],
  ])("reads the %s model button", (description, expected) => {
    expect(parseComposerLabel(description)).toEqual(expected);
  });

  it("builds JXA programs that parse", () => {
    for (const script of [FRONT_APP_SCRIPT, COMPOSER_SCRIPT])
      expect(() => new Function(script)).not.toThrow();
    expect(COMPOSER_SCRIPT).toContain("const effortFromLabel = function");
  });
});
