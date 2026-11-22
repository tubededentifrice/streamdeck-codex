import { describe, expect, it } from "vitest";

import { CHATGPT_ACTION } from "../src/chatgpt/composer-action";
import {
  parseChatGPTLabel,
  parsePowerAnnouncement,
} from "../src/chatgpt/labels";
import { FRONT_APP_SCRIPT } from "../src/apps/front-app-script";

describe("ChatGPT labels", () => {
  it.each([
    ["GPT-6.2 Sol High", "GPT-6.2 Sol", "high"],
    ["GPT-6.2 Sol Extra High", "GPT-6.2 Sol", "xhigh"],
    ["GPT-6.2 Sol Light", "GPT-6.2 Sol", "low"],
    ["GPT-6.2 Sol Medium", "GPT-6.2 Sol", "medium"],
    ["GPT-6.2 Sol Standard", "GPT-6.2 Sol", "medium"],
    ["GPT-6.2 Sol Extended", "GPT-6.2 Sol", "high"],
    ["Custom High", "Custom", "high"],
    ["GPT-6.2 Sol", "GPT-6.2 Sol", undefined],
  ])("reads %s", (label, model, effort) => {
    expect(parseChatGPTLabel(label)).toEqual({ effort, model });
  });

  it("reads no model from an empty label", () => {
    expect(parseChatGPTLabel("  ")).toBeUndefined();
  });

  it.each([
    [
      "GPT-6.2 Sol Extended, 3 of 4.",
      { label: "GPT-6.2 Sol Extended", position: 3, total: 4 },
    ],
    [
      "GPT-6.2 Sol Extra High, 4 of 4. Consumes usage faster",
      { label: "GPT-6.2 Sol Extra High", position: 4, total: 4 },
    ],
  ])("reads the slider announcement %s", (text, expected) => {
    expect(parsePowerAnnouncement(text)).toEqual(expected);
  });

  it("ignores other status text", () => {
    expect(
      parsePowerAnnouncement("Use Left and Right arrow keys to adjust power"),
    ).toBeUndefined();
  });

  it("uses keyboard input, because ChatGPT can hide AXPress", () => {
    expect(CHATGPT_ACTION).not.toMatch(/\bpress\(/);
    expect(CHATGPT_ACTION).toContain("activate(button, KEY_SPACE)");
  });

  it("injects self-contained label functions into the watcher script", () => {
    expect(CHATGPT_ACTION).toContain("const parseChatGPTLabel = function");
    expect(FRONT_APP_SCRIPT).toContain(CHATGPT_ACTION);
    const parse = new Function(
      `return ${parseChatGPTLabel.toString()};`,
    )() as typeof parseChatGPTLabel;
    expect(parse("GPT-6.2 Sol Extra High")).toEqual({
      effort: "xhigh",
      model: "GPT-6.2 Sol",
    });
  });
});
