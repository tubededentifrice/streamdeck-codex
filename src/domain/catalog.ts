import {
  type ActionSettings,
  choicesFor,
  isConfigValue,
  type ModelChoice,
  sameEffort,
  sameModel,
  type SettingsActionKind,
  type ThinkingChoice,
} from "./settings";

/**
 * The models and thinking levels that any key uses. Each entry has the catalog
 * revision that added it. A key merges each entry once, as a disabled value,
 * so a value that the user removes from a key does not come back.
 */
export type ValueCatalog = {
  efforts: { effort: string; label: string; revision: number }[];
  models: { label: string; model: string; revision: number }[];
  revision: number;
};

export type CatalogAdditions = {
  efforts?: readonly { effort: string; label?: string }[];
  models?: readonly { label?: string; model: string }[];
};

const MAX_MODELS = 100;
const MAX_EFFORTS = 30;
const MAX_CHOICES = 20;
const STYLE_IDS = [
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
];

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function label(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 32)
    : fallback;
}

function revision(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : 0;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function emptyCatalog(): ValueCatalog {
  return { efforts: [], models: [], revision: 0 };
}

export function sanitizeCatalog(value: unknown): ValueCatalog {
  const source = record(value);
  if (!source) return emptyCatalog();
  const models: ValueCatalog["models"] = [];
  for (const item of Array.isArray(source.models) ? source.models : []) {
    const entry = record(item);
    const model = entry?.model;
    if (!isConfigValue(model) || models.some((m) => sameModel(m.model, model)))
      continue;
    models.push({
      label: label(entry?.label, model),
      model,
      revision: revision(entry?.revision),
    });
    if (models.length >= MAX_MODELS) break;
  }
  const efforts: ValueCatalog["efforts"] = [];
  for (const item of Array.isArray(source.efforts) ? source.efforts : []) {
    const entry = record(item);
    const effort = entry?.effort;
    if (
      !isConfigValue(effort) ||
      efforts.some((e) => sameEffort(e.effort, effort))
    )
      continue;
    efforts.push({
      effort,
      label: label(entry?.label, titleCase(effort)),
      revision: revision(entry?.revision),
    });
    if (efforts.length >= MAX_EFFORTS) break;
  }
  const highest = Math.max(
    0,
    ...models.map((m) => m.revision),
    ...efforts.map((e) => e.revision),
  );
  return {
    efforts,
    models,
    revision: Math.max(revision(source.revision), highest),
  };
}

/** Returns the catalog with the new values, or undefined when none is new. */
export function addToCatalog(
  catalog: ValueCatalog,
  additions: CatalogAdditions,
): ValueCatalog | undefined {
  const next = structuredClone(catalog);
  for (const item of additions.models ?? []) {
    if (
      !isConfigValue(item.model) ||
      next.models.length >= MAX_MODELS ||
      next.models.some((m) => sameModel(m.model, item.model))
    )
      continue;
    next.revision += 1;
    next.models.push({
      label: label(item.label, item.model),
      model: item.model,
      revision: next.revision,
    });
  }
  for (const item of additions.efforts ?? []) {
    if (
      !isConfigValue(item.effort) ||
      next.efforts.length >= MAX_EFFORTS ||
      next.efforts.some((e) => sameEffort(e.effort, item.effort))
    )
      continue;
    next.revision += 1;
    next.efforts.push({
      effort: item.effort,
      label: label(item.label, titleCase(item.effort)),
      revision: next.revision,
    });
  }
  return next.revision === catalog.revision ? undefined : next;
}

/** The models and thinking levels that a key has configured. */
export function catalogValuesOf(
  kind: SettingsActionKind,
  settings: ActionSettings,
): CatalogAdditions {
  if (kind === "model")
    return {
      models: choicesFor("model", settings).map(({ label, model }) => ({
        label,
        model,
      })),
    };
  if (kind === "thinking")
    return {
      efforts: choicesFor("thinking", settings).map(({ effort, label }) => ({
        effort,
        label,
      })),
    };
  const presets = choicesFor("preset", settings);
  return {
    efforts: presets.map(({ effort }) => ({ effort })),
    models: presets.map(({ label, model }) => ({ label, model })),
  };
}

/**
 * Adds the catalog entries that the key has not merged yet, as disabled
 * values. Returns undefined when the settings do not change.
 */
export function mergeCatalog(
  kind: SettingsActionKind,
  settings: ActionSettings,
  catalog: ValueCatalog,
): ActionSettings | undefined {
  const seen = revision(settings.catalogRevision);
  if (seen >= catalog.revision) return undefined;
  const next = structuredClone(settings);
  next.catalogRevision = catalog.revision;
  if (kind === "model") {
    const models: ModelChoice[] = Array.isArray(next.models) ? next.models : [];
    for (const entry of catalog.models) {
      if (entry.revision <= seen || models.length >= MAX_CHOICES) continue;
      if (
        models.some(
          (m) =>
            typeof m?.model === "string" && sameModel(m.model, entry.model),
        )
      )
        continue;
      models.push({
        enabled: false,
        label: entry.label,
        model: entry.model,
        styleId: STYLE_IDS[models.length % STYLE_IDS.length],
      });
    }
    next.models = models;
  } else if (kind === "thinking") {
    const efforts: ThinkingChoice[] = Array.isArray(next.thinking)
      ? next.thinking
      : [];
    for (const entry of catalog.efforts) {
      if (entry.revision <= seen || efforts.length >= MAX_CHOICES) continue;
      if (
        efforts.some(
          (e) =>
            typeof e?.effort === "string" && sameEffort(e.effort, entry.effort),
        )
      )
        continue;
      efforts.push({
        effort: entry.effort,
        enabled: false,
        label: entry.label,
        styleId: STYLE_IDS[efforts.length % STYLE_IDS.length],
      });
    }
    next.thinking = efforts;
  }
  return next;
}
