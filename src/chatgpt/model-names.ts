import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeLabel } from "../apps/labels";

const REFRESH_INTERVAL = 30_000;

type ReadText = (file: string) => string;

/**
 * Maps the model names of the ChatGPT model button, such as "GPT-6.2 Sol", to
 * model ids. Codex keeps the model list in `~/.codex/models_cache.json`.
 */
export class ChatGPTModelNames {
  readonly #file: string;
  readonly #readText: ReadText;
  #loadedAt = Number.NEGATIVE_INFINITY;
  #ids = new Map<string, string>();

  constructor(options: { file?: string; readText?: ReadText } = {}) {
    this.#file =
      options.file ??
      path.join(
        process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
        "models_cache.json",
      );
    this.#readText =
      options.readText ?? ((file) => fs.readFileSync(file, "utf8"));
  }

  /** Returns the model id for a button name, or the name when it is unknown. */
  idFor(name: string): string {
    if (Date.now() - this.#loadedAt >= REFRESH_INTERVAL) this.#load();
    return this.#ids.get(normalizeLabel(name)) ?? name;
  }

  #load(): void {
    this.#loadedAt = Date.now();
    let value: unknown;
    try {
      value = JSON.parse(this.#readText(this.#file));
    } catch {
      return;
    }
    const models =
      typeof value === "object" && value !== null && "models" in value
        ? (value as { models: unknown }).models
        : undefined;
    if (!Array.isArray(models)) return;
    const ids = new Map<string, string>();
    for (const model of models) {
      const slug = (model as { slug?: unknown })?.slug;
      const name = (model as { display_name?: unknown })?.display_name;
      if (typeof slug !== "string" || !slug) continue;
      if (typeof name === "string" && name && !ids.has(normalizeLabel(name)))
        ids.set(normalizeLabel(name), slug);
      ids.set(normalizeLabel(slug), slug);
    }
    this.#ids = ids;
  }
}
