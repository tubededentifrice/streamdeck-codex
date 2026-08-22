import type { JsonObject } from "@elgato/utils";

import type { ActionKind, CodexState } from "./settings";

export type KeyStyle = Readonly<{
  backgroundColor: string;
  borderColor: string;
  fontColor: string;
  id: string;
  name: string;
}>;

export type PluginGlobalSettings = JsonObject & {
  customStyles?: KeyStyle[];
  lastRoute?: { hostId: string; threadId: string };
};

type StyledChoice = {
  effort?: string;
  model?: string;
  styleId?: string;
};

export type StyleActionSettings = {
  models?: StyledChoice[];
  presets?: StyledChoice[];
  thinking?: StyledChoice[];
};

const createBuiltIn = (
  name: string,
  borderColor: string,
  backgroundColor: string,
  fontColor: string,
): KeyStyle =>
  Object.freeze({
    backgroundColor,
    borderColor,
    fontColor,
    id: `builtin:${name.toLowerCase()}`,
    name,
  });

export const BUILT_IN_STYLES: readonly KeyStyle[] = Object.freeze([
  createBuiltIn("Ocean", "#38BDF8", "#082F49", "#F0F9FF"),
  createBuiltIn("Azure", "#60A5FA", "#172554", "#EFF6FF"),
  createBuiltIn("Indigo", "#818CF8", "#1E1B4B", "#EEF2FF"),
  createBuiltIn("Violet", "#A78BFA", "#2E1065", "#F5F3FF"),
  createBuiltIn("Plum", "#E879F9", "#4A044E", "#FDF4FF"),
  createBuiltIn("Rose", "#FB7185", "#4C0519", "#FFF1F2"),
  createBuiltIn("Coral", "#F97316", "#431407", "#FFF7ED"),
  createBuiltIn("Amber", "#FBBF24", "#451A03", "#FFFBEB"),
  createBuiltIn("Lime", "#A3E635", "#1A2E05", "#F7FEE7"),
  createBuiltIn("Emerald", "#34D399", "#022C22", "#ECFDF5"),
  createBuiltIn("Teal", "#2DD4BF", "#042F2E", "#F0FDFA"),
  createBuiltIn("Cyan", "#22D3EE", "#083344", "#ECFEFF"),
  createBuiltIn("Slate", "#94A3B8", "#0F172A", "#F8FAFC"),
  createBuiltIn("Silver", "#D1D5DB", "#1F2937", "#F9FAFB"),
  createBuiltIn("Crimson", "#F43F5E", "#3F0712", "#FFF1F2"),
  createBuiltIn("Gold", "#FACC15", "#422006", "#FEFCE8"),
]);

export const NEUTRAL_STYLE = BUILT_IN_STYLES[12];

const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const CUSTOM_ID_PATTERN = /^custom:[A-Za-z0-9][A-Za-z0-9_-]{0,56}$/;
const MAX_CUSTOM_STYLES = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeCustomStyles(value: unknown): KeyStyle[] {
  if (!Array.isArray(value)) return [];

  const styles: KeyStyle[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (styles.length === MAX_CUSTOM_STYLES) break;
    if (!isRecord(candidate)) continue;

    const id = typeof candidate.id === "string" ? candidate.id : "";
    const name =
      typeof candidate.name === "string" ? candidate.name.trim() : "";
    const borderColor = candidate.borderColor;
    const backgroundColor = candidate.backgroundColor;
    const fontColor = candidate.fontColor;

    if (
      !CUSTOM_ID_PATTERN.test(id) ||
      seen.has(id) ||
      name.length < 1 ||
      name.length > 32 ||
      typeof borderColor !== "string" ||
      !COLOR_PATTERN.test(borderColor) ||
      typeof backgroundColor !== "string" ||
      !COLOR_PATTERN.test(backgroundColor) ||
      typeof fontColor !== "string" ||
      !COLOR_PATTERN.test(fontColor)
    ) {
      continue;
    }

    seen.add(id);
    styles.push({ backgroundColor, borderColor, fontColor, id, name });
  }

  return styles;
}

export function resolveStyleById(
  styleId: unknown,
  globalSettings: Pick<PluginGlobalSettings, "customStyles"> = {},
): KeyStyle {
  if (typeof styleId !== "string") return NEUTRAL_STYLE;

  return (
    BUILT_IN_STYLES.find((style) => style.id === styleId) ??
    sanitizeCustomStyles(globalSettings.customStyles).find(
      (style) => style.id === styleId,
    ) ??
    NEUTRAL_STYLE
  );
}

export function activeStyleFor(
  kind: ActionKind,
  settings: StyleActionSettings,
  state: Pick<CodexState, "effort" | "model">,
  globalSettings: Pick<PluginGlobalSettings, "customStyles"> = {},
): KeyStyle {
  const choices =
    kind === "model"
      ? settings.models
      : kind === "thinking"
        ? settings.thinking
        : settings.presets;

  const activeChoice = choices?.find((choice) => {
    if (kind === "model") return choice.model === state.model;
    if (kind === "thinking") return choice.effort === state.effort;
    return choice.model === state.model && choice.effort === state.effort;
  });

  return resolveStyleById(activeChoice?.styleId, globalSettings);
}
