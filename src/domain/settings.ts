import type { JsonObject } from "@elgato/utils";

/** `single` sets one preset and shows whether the task uses it. */
export type SettingsActionKind = "model" | "thinking" | "preset" | "single";
export type ActionKind = SettingsActionKind | "shortcut";
export type ShortcutId =
  "review" | "terminal" | "browser" | "files" | "side-chat";

/** `enabled: false` keeps a value for display but leaves it out of the cycle. */
export type ModelChoice = {
  enabled?: boolean;
  label: string;
  model: string;
  styleId?: string;
};
export type ThinkingChoice = {
  effort: string;
  enabled?: boolean;
  label: string;
  styleId?: string;
};
export type PresetChoice = {
  effort: string;
  enabled?: boolean;
  label: string;
  model: string;
  styleId?: string;
};
export type ShortcutChoice = {
  label: string;
  shortcut: ShortcutId;
  styleId?: string;
};

export type ActionSettings = JsonObject & {
  /** The last value catalog revision that this key merged. */
  catalogRevision?: number;
  /** How much a single preset key fades while the task uses other values (0–100). */
  inactiveFade?: number;
  modelFontSize?: number;
  models?: ModelChoice[];
  presets?: PresetChoice[];
  showNext?: boolean;
  showTitle?: boolean;
  shortcutFontSize?: number;
  shortcuts?: ShortcutChoice[];
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

const DEFAULT_SHORTCUTS: ShortcutChoice[] = [
  { label: "Review", shortcut: "review", styleId: "builtin:emerald" },
];

export const SHORTCUT_OPTIONS: readonly Readonly<ShortcutChoice>[] =
  Object.freeze([
    Object.freeze({ label: "Review", shortcut: "review" }),
    Object.freeze({ label: "Terminal", shortcut: "terminal" }),
    Object.freeze({ label: "Browser", shortcut: "browser" }),
    Object.freeze({ label: "Files", shortcut: "files" }),
    Object.freeze({ label: "Side chat", shortcut: "side-chat" }),
  ]);

export const DEFAULT_INACTIVE_FADE = 75;
const MAX_CHOICES = 20;
const VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const STYLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function clean(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/** A model id or thinking value that a key can store. */
export function isConfigValue(value: unknown): value is string {
  return typeof value === "string" && VALUE_PATTERN.test(value);
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
  if (kind === "shortcut")
    return {
      ...display,
      showNext: false,
      shortcutFontSize: 18,
      shortcuts: structuredClone(DEFAULT_SHORTCUTS),
    };
  if (kind === "single")
    return {
      ...display,
      inactiveFade: DEFAULT_INACTIVE_FADE,
      modelFontSize: 21,
      presets: structuredClone(DEFAULT_PRESETS.slice(0, 1)),
      showNext: false,
      thinkingFontSize: 18,
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
  kind: "preset" | "single",
  settings: ActionSettings,
): PresetChoice[];
export function choicesFor(
  kind: "shortcut",
  settings: ActionSettings,
): ShortcutChoice[];
export function choicesFor(
  kind: ActionKind,
  settings: ActionSettings,
): Array<ModelChoice | ThinkingChoice | PresetChoice | ShortcutChoice> {
  if (kind === "model") {
    const choices = (
      Array.isArray(settings.models) ? settings.models : DEFAULT_MODELS
    )
      .slice(0, MAX_CHOICES)
      .map((choice) => ({
        ...(choice?.enabled === false ? { enabled: false } : {}),
        label: clean(choice?.label, 32),
        model: cleanValue(choice?.model),
        styleId: cleanStyleId(choice?.styleId),
      }))
      .filter((choice) => choice.model)
      .map((choice) => ({ ...choice, label: choice.label || choice.model }));
    return uniqueBy(choices, (choice) => comparable(choice.model));
  }

  if (kind === "thinking") {
    const choices = (
      Array.isArray(settings.thinking) ? settings.thinking : DEFAULT_THINKING
    )
      .slice(0, MAX_CHOICES)
      .map((choice) => ({
        effort: cleanValue(choice?.effort),
        ...(choice?.enabled === false ? { enabled: false } : {}),
        label: clean(choice?.label, 32),
        styleId: cleanStyleId(choice?.styleId),
      }))
      .filter((choice) => choice.effort)
      .map((choice) => ({ ...choice, label: choice.label || choice.effort }));
    return uniqueBy(choices, (choice) => comparable(choice.effort));
  }

  if (kind === "shortcut") {
    const allowed = new Map(
      SHORTCUT_OPTIONS.map((choice) => [choice.shortcut, choice.label]),
    );
    const choices = (
      Array.isArray(settings.shortcuts) ? settings.shortcuts : DEFAULT_SHORTCUTS
    )
      .map((choice) => ({
        label: clean(choice?.label, 32),
        shortcut: cleanValue(choice?.shortcut),
        styleId: cleanStyleId(choice?.styleId),
      }))
      .filter((choice) => allowed.has(choice.shortcut as ShortcutId))
      .map((choice) => ({
        ...choice,
        label:
          choice.label || allowed.get(choice.shortcut as ShortcutId) || "Open",
        shortcut: choice.shortcut as ShortcutId,
      }))
      .slice(0, 1);
    return choices;
  }

  // A single preset key uses only its first value, and that value is always on.
  const single = kind === "single";
  const choices = (
    Array.isArray(settings.presets) ? settings.presets : DEFAULT_PRESETS
  )
    .slice(0, single ? 1 : MAX_CHOICES)
    .map((choice) => ({
      effort: cleanValue(choice?.effort),
      ...(!single && choice?.enabled === false ? { enabled: false } : {}),
      label: clean(choice?.label, 32),
      model: cleanValue(choice?.model),
      styleId: cleanStyleId(choice?.styleId),
    }))
    .filter((choice) => choice.model && choice.effort)
    .map((choice) => ({
      ...choice,
      label: choice.label || `${choice.model} · ${choice.effort}`,
    }));
  return uniqueBy(
    choices,
    (choice) => `${comparable(choice.model)}\0${comparable(choice.effort)}`,
  );
}

function comparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Matches a model id with an app label: "gpt-6.2-sol" and "GPT-6.2-Sol". */
export function sameModel(a: string, b: string): boolean {
  return comparable(a) === comparable(b);
}

export function sameEffort(a: string, b: string): boolean {
  return comparable(a) === comparable(b);
}

export function matchesChoice(
  kind: SettingsActionKind,
  choice: { effort?: unknown; model?: unknown },
  state: Pick<CodexState, "effort" | "model">,
): boolean {
  const model =
    typeof choice.model === "string" && sameModel(choice.model, state.model);
  const effort =
    typeof choice.effort === "string" &&
    sameEffort(choice.effort, state.effort);
  if (kind === "model") return model;
  if (kind === "thinking") return effort;
  return model && effort;
}

/** The enabled values, in the order that a key cycles through them. */
export function cycleChoices(
  kind: SettingsActionKind,
  settings: ActionSettings,
): Array<ModelChoice | ThinkingChoice | PresetChoice> {
  return choicesFor(kind as "preset", settings).filter(
    (choice) => choice.enabled !== false,
  );
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
  kind: "preset" | "single",
  settings: ActionSettings,
  state: CodexState,
): PresetChoice | undefined;
export function nextChoice(
  kind: SettingsActionKind,
  settings: ActionSettings,
  state: CodexState,
): ModelChoice | ThinkingChoice | PresetChoice | undefined {
  const choices = cycleChoices(kind, settings);
  if (choices.length === 0) return undefined;

  const index = choices.findIndex((choice) =>
    matchesChoice(kind, choice, state),
  );

  if (choices.length === 1 || index < 0) return choices[0];
  return choices[(index + 1) % choices.length];
}

export function displayChoice(
  kind: SettingsActionKind,
  settings: ActionSettings,
  state: CodexState,
): ModelChoice | ThinkingChoice | PresetChoice | undefined {
  const choices = choicesFor(kind as "preset", settings);
  const exact = choices.find((choice) => matchesChoice(kind, choice, state));
  if (exact || kind !== "preset") return exact;
  return choices.find((choice) =>
    sameModel((choice as PresetChoice).model, state.model),
  );
}

export function targetState(
  kind: SettingsActionKind,
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
