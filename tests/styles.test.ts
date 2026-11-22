import { describe, expect, it } from "vitest";

import {
  activeStyleFor,
  BUILT_IN_STYLES,
  NEUTRAL_STYLE,
  resolveStyleById,
  sanitizeCustomStyles,
} from "../src/domain/styles";

const customStyle = {
  backgroundColor: "#112233",
  borderColor: "#AABBCC",
  fontColor: "#FFFFFF",
  id: "custom:night",
  name: "Night",
};

function luminance(color: string): number {
  const channels = color
    .slice(1)
    .match(/.{2}/g)
    ?.map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4),
    );
  if (!channels) throw new Error("Invalid test color.");
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first: string, second: string): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("key styles", () => {
  it("provides 16 immutable built-in styles", () => {
    expect(BUILT_IN_STYLES).toHaveLength(16);
    expect(BUILT_IN_STYLES.map((style) => style.id)).toEqual([
      "builtin:ocean",
      "builtin:azure",
      "builtin:indigo",
      "builtin:violet",
      "builtin:plum",
      "builtin:rose",
      "builtin:coral",
      "builtin:amber",
      "builtin:lime",
      "builtin:emerald",
      "builtin:teal",
      "builtin:cyan",
      "builtin:slate",
      "builtin:silver",
      "builtin:crimson",
      "builtin:gold",
    ]);
    expect(Object.isFrozen(BUILT_IN_STYLES)).toBe(true);
    expect(BUILT_IN_STYLES.every(Object.isFrozen)).toBe(true);
  });

  it("uses the exact built-in palette", () => {
    expect(
      BUILT_IN_STYLES.map(
        ({ name, borderColor, backgroundColor, fontColor }) => [
          name,
          borderColor,
          backgroundColor,
          fontColor,
        ],
      ),
    ).toEqual([
      ["Ocean", "#38BDF8", "#082F49", "#F0F9FF"],
      ["Azure", "#60A5FA", "#172554", "#EFF6FF"],
      ["Indigo", "#818CF8", "#1E1B4B", "#EEF2FF"],
      ["Violet", "#A78BFA", "#2E1065", "#F5F3FF"],
      ["Plum", "#E879F9", "#4A044E", "#FDF4FF"],
      ["Rose", "#FB7185", "#4C0519", "#FFF1F2"],
      ["Coral", "#F97316", "#431407", "#FFF7ED"],
      ["Amber", "#FBBF24", "#451A03", "#FFFBEB"],
      ["Lime", "#A3E635", "#1A2E05", "#F7FEE7"],
      ["Emerald", "#34D399", "#022C22", "#ECFDF5"],
      ["Teal", "#2DD4BF", "#042F2E", "#F0FDFA"],
      ["Cyan", "#22D3EE", "#083344", "#ECFEFF"],
      ["Slate", "#94A3B8", "#0F172A", "#F8FAFC"],
      ["Silver", "#D1D5DB", "#1F2937", "#F9FAFB"],
      ["Crimson", "#F43F5E", "#3F0712", "#FFF1F2"],
      ["Gold", "#FACC15", "#422006", "#FEFCE8"],
    ]);
    expect(NEUTRAL_STYLE).toEqual({
      backgroundColor: "#303030",
      borderColor: "#A3A3A3",
      fontColor: "#F5F5F5",
      id: "fallback:unconfigured",
      name: "Unconfigured",
    });
    expect(Object.isFrozen(NEUTRAL_STYLE)).toBe(true);
  });

  it("keeps built-in text and borders distinct from their backgrounds", () => {
    for (const style of BUILT_IN_STYLES) {
      expect(contrast(style.fontColor, style.backgroundColor)).toBeGreaterThan(
        10,
      );
      expect(
        contrast(style.borderColor, style.backgroundColor),
      ).toBeGreaterThan(3);
    }
  });

  it("sanitizes custom styles and keeps the first unique ID", () => {
    expect(
      sanitizeCustomStyles([
        { ...customStyle, name: "  Night  " },
        { ...customStyle, name: "Duplicate" },
        { ...customStyle, id: "builtin:ocean" },
        { ...customStyle, id: "custom:bad value" },
        { ...customStyle, id: "custom:bad-color", fontColor: "white" },
        { ...customStyle, id: "custom:empty-name", name: "  " },
        { ...customStyle, id: "custom:long-name", name: "x".repeat(33) },
      ]),
    ).toEqual([customStyle]);
  });

  it("limits custom styles to 64 entries", () => {
    const values = Array.from({ length: 70 }, (_, index) => ({
      ...customStyle,
      id: `custom:style_${index}`,
    }));
    expect(sanitizeCustomStyles(values)).toHaveLength(64);
  });

  it("resolves built-in and custom IDs with a neutral fallback", () => {
    expect(resolveStyleById("builtin:gold").name).toBe("Gold");
    expect(
      resolveStyleById("custom:night", { customStyles: [customStyle] }),
    ).toEqual(customStyle);
    expect(resolveStyleById("missing")).toBe(NEUTRAL_STYLE);
  });

  it("selects the style from the matching model row", () => {
    expect(
      activeStyleFor(
        "model",
        {
          models: [
            { model: "gpt-5.6-sol", styleId: "builtin:ocean" },
            { model: "gpt-5.6-luna", styleId: "custom:night" },
          ],
        },
        { effort: "high", model: "gpt-5.6-luna" },
        { customStyles: [customStyle] },
      ),
    ).toEqual(customStyle);
  });

  it("matches thinking by effort and presets by both values", () => {
    const state = { effort: "high", model: "gpt-5.6-luna" };
    expect(
      activeStyleFor(
        "thinking",
        { thinking: [{ effort: "high", styleId: "builtin:violet" }] },
        state,
      ).id,
    ).toBe("builtin:violet");
    expect(
      activeStyleFor(
        "preset",
        {
          presets: [
            {
              effort: "medium",
              model: "gpt-5.6-luna",
              styleId: "builtin:coral",
            },
            {
              effort: "high",
              model: "gpt-5.6-luna",
              styleId: "builtin:emerald",
            },
          ],
        },
        state,
      ).id,
    ).toBe("builtin:emerald");
  });

  it("uses the neutral style when no configured row matches", () => {
    expect(
      activeStyleFor(
        "model",
        { models: [{ model: "gpt-5.6-sol", styleId: "builtin:ocean" }] },
        { effort: "high", model: "gpt-5.6-luna" },
      ),
    ).toBe(NEUTRAL_STYLE);
  });

  it("uses the configured colors of a single preset key in each state", () => {
    const settings = {
      presets: [
        { effort: "high", model: "gpt-5.6-luna", styleId: "custom:night" },
      ],
    };
    const globals = { customStyles: [customStyle] };
    for (const state of [
      { effort: "high", model: "gpt-5.6-luna" },
      { effort: "medium", model: "gpt-5.6-sol" },
    ])
      expect(activeStyleFor("single", settings, state, globals).id).toBe(
        "custom:night",
      );
  });
});
