import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeLabel } from "./labels";

const REFRESH_INTERVAL = 30_000;

type ReadDirectory = (directory: string) => string[];
type ReadText = (file: string) => string;

/**
 * Maps the names in the T3 Code model picker to model ids. T3 Code keeps its
 * provider model lists in `~/.t3/caches/<provider>.json`.
 */
export class T3ModelNames {
  readonly #directory: string;
  readonly #readDirectory: ReadDirectory;
  readonly #readText: ReadText;
  #loadedAt = Number.NEGATIVE_INFINITY;
  #ids = new Map<string, string>();

  constructor(
    options: {
      directory?: string;
      readDirectory?: ReadDirectory;
      readText?: ReadText;
    } = {},
  ) {
    this.#directory =
      options.directory ??
      path.join(
        process.env.T3CODE_HOME || path.join(os.homedir(), ".t3"),
        "caches",
      );
    this.#readDirectory =
      options.readDirectory ?? ((directory) => fs.readdirSync(directory));
    this.#readText =
      options.readText ?? ((file) => fs.readFileSync(file, "utf8"));
  }

  /** Returns the model id for a picker name, or the name when it is unknown. */
  idFor(name: string): string {
    if (Date.now() - this.#loadedAt >= REFRESH_INTERVAL) this.#load();
    return this.#ids.get(normalizeLabel(name)) ?? name;
  }

  #load(): void {
    this.#loadedAt = Date.now();
    const ids = new Map<string, string>();
    let files: string[];
    try {
      files = this.#readDirectory(this.#directory).filter((file) =>
        file.endsWith(".json"),
      );
    } catch {
      return;
    }
    for (const file of files) {
      let value: unknown;
      try {
        value = JSON.parse(this.#readText(path.join(this.#directory, file)));
      } catch {
        continue;
      }
      const models =
        typeof value === "object" && value !== null && "models" in value
          ? (value as { models: unknown }).models
          : undefined;
      if (!Array.isArray(models)) continue;
      for (const model of models) {
        const slug = (model as { slug?: unknown })?.slug;
        const name = (model as { name?: unknown })?.name;
        if (typeof slug !== "string" || !slug) continue;
        if (typeof name === "string" && name)
          ids.set(normalizeLabel(name), slug);
        ids.set(normalizeLabel(slug), slug);
      }
    }
    this.#ids = ids;
  }
}
