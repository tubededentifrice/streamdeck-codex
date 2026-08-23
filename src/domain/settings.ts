import type { JsonObject } from "@elgato/utils";

export type ActionKind = "model" | "thinking" | "preset";

export type ModelChoice = { label: string; model: string; styleId?: string };
export type ThinkingChoice = {
  effort: string;
  label: string;
  styleId?: string;
};
export type PresetChoice = {
  effort: string;
  label: string;
  model: string;
  styleId?: string;
};

export type ActionSettings = JsonObject & {
  modelFontSize?: number;
  models?: ModelChoice[];
  presets?: PresetChoice[];
  showNext?: boolean;
  showTitle?: boolean;
  thinkingFontSize?: number;
  thinking?: ThinkingChoice[];
};

export type CodexState = {
  effort: string;
  hostId: string;
  model: string;
  threadId: string;
};

const DEFAULT_MODELS: ModelChoice[] = [
  { label: "Sol", model: "gpt-5.6-sol", styleId: "builtin:ocean" },
  { label: "Luna", model: "gpt-5.6-luna", styleId: "builtin:violet" },
];

const DEFAULT_THINKING: ThinkingChoice[] = [
  { effort: "medium", label: "Medium", styleId: "builtin:amber" },
  { effort: "high", label: "High", styleId: "builtin:rose" },
];

const DEFAULT_PRESETS: PresetChoice[] = [
  {
    effort: "medium",
    label: "Sol",
    model: "gpt-5.6-sol",
    styleId: "builtin:ocean",
  },
  {
    effort: "high",
    label: "Luna",
    model: "gpt-5.6-luna",
    styleId: "builtin:violet",
  },
];

const MAX_CHOICES = 20;
const VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const STYLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function clean(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanValue(value: unknown): string {
  const result = clean(value, 128);
  return VALUE_PATTERN.test(result) ? result : "";
}

function cleanStyleId(value: unknown): string | undefined {
  const result = clean(value, 128);
  return STYLE_ID_PATTERN.test(result) ? result : undefined;
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function defaultsFor(kind: ActionKind): ActionSettings {
  const display = { showNext: true, showTitle: true };
  if (kind === "model")
    return {
      ...display,
      modelFontSize: 21,
      models: structuredClone(DEFAULT_MODELS),
    };
  if (kind === "thinking")
    return {
      ...display,
      thinking: structuredClone(DEFAULT_THINKING),
      thinkingFontSize: 21,
    };
  return {
    ...display,
    modelFontSize: 21,
    presets: structuredClone(DEFAULT_PRESETS),
    thinkingFontSize: 18,
  };
}

export function choicesFor(
  kind: "model",
  settings: ActionSettings,
): ModelChoice[];
export function choicesFor(
  kind: "thinking",
  settings: ActionSettings,
): ThinkingChoice[];
export function choicesFor(
  kind: "preset",
  settings: ActionSettings,
): PresetChoice[];
export function choicesFor(
  kind: ActionKind,
  settings: ActionSettings,
): Array<ModelChoice | ThinkingChoice | PresetChoice> {
  if (kind === "model") {
    const choices = (
      Array.isArray(settings.models) ? settings.models : DEFAULT_MODELS
    )
      .slice(0, MAX_CHOICES)
      .map((choice) => ({
        label: clean(choice?.label, 32),
        model: cleanValue(choice?.model),
        styleId: cleanStyleId(choice?.styleId),
      }))
      .filter((choice) => choice.model)
      .map((choice) => ({ ...choice, label: choice.label || choice.model }));
    return uniqueBy(choices, (choice) => choice.model);
  }

  if (kind === "thinking") {
    const choices = (
      Array.isArray(settings.thinking) ? settings.thinking : DEFAULT_THINKING
    )
      .slice(0, MAX_CHOICES)
      .map((choice) => ({
        effort: cleanValue(choice?.effort),
        label: clean(choice?.label, 32),
        styleId: cleanStyleId(choice?.styleId),
      }))
      .filter((choice) => choice.effort)
      .map((choice) => ({ ...choice, label: choice.label || choice.effort }));
    return uniqueBy(choices, (choice) => choice.effort);
  }

  const choices = (
    Array.isArray(settings.presets) ? settings.presets : DEFAULT_PRESETS
  )
    .slice(0, MAX_CHOICES)
    .map((choice) => ({
      effort: cleanValue(choice?.effort),
      label: clean(choice?.label, 32),
      model: cleanValue(choice?.model),
      styleId: cleanStyleId(choice?.styleId),
    }))
    .filter((choice) => choice.model && choice.effort)
    .map((choice) => ({
      ...choice,
      label: choice.label || `${choice.model} · ${choice.effort}`,
    }));
  return uniqueBy(choices, (choice) => `${choice.model}\0${choice.effort}`);
}

export function nextChoice(
  kind: "model",
  settings: ActionSettings,
  state: CodexState,
): ModelChoice | undefined;
export function nextChoice(
  kind: "thinking",
  settings: ActionSettings,
  state: CodexState,
): ThinkingChoice | undefined;
export function nextChoice(
  kind: "preset",
  settings: ActionSettings,
  state: CodexState,
): PresetChoice | undefined;
export function nextChoice(
  kind: ActionKind,
  settings: ActionSettings,
  state: CodexState,
): ModelChoice | ThinkingChoice | PresetChoice | undefined {
  const choices = choicesFor(kind as "preset", settings);
  if (choices.length === 0) return undefined;

  const index = choices.findIndex((choice) => {
    if (kind === "model") return (choice as ModelChoice).model === state.model;
    if (kind === "thinking")
      return (choice as ThinkingChoice).effort === state.effort;
    const preset = choice as PresetChoice;
    return preset.model === state.model && preset.effort === state.effort;
  });

  if (choices.length === 1 || index < 0) return choices[0];
  return choices[(index + 1) % choices.length];
}

export function displayChoice(
  kind: ActionKind,
  settings: ActionSettings,
  state: CodexState,
): ModelChoice | ThinkingChoice | PresetChoice | undefined {
  const choices = choicesFor(kind as "preset", settings);
  const exact = choices.find((choice) => {
    if (kind === "model") return (choice as ModelChoice).model === state.model;
    if (kind === "thinking")
      return (choice as ThinkingChoice).effort === state.effort;
    const preset = choice as PresetChoice;
    return preset.model === state.model && preset.effort === state.effort;
  });
  if (exact || kind !== "preset") return exact;
  return choices.find(
    (choice) => (choice as PresetChoice).model === state.model,
  );
}

export function targetState(
  kind: ActionKind,
  choice: ModelChoice | ThinkingChoice | PresetChoice,
  current: CodexState,
): Pick<CodexState, "effort" | "model"> {
  if (kind === "model")
    return { effort: current.effort, model: (choice as ModelChoice).model };
  if (kind === "thinking")
    return { effort: (choice as ThinkingChoice).effort, model: current.model };
  const preset = choice as PresetChoice;
  return { effort: preset.effort, model: preset.model };
}
