import { isConfigValue, sameModel } from "./settings";

const MAX_MODELS = 20;

/** The models that tasks used while the plug-in runs, newest first. */
export class RecentModels {
  #ids: string[] = [];

  /** Adds a model id. An app name, such as "GPT-6.2 Sol", becomes "gpt-6.2-sol". */
  add(model: string): void {
    const id = /\s/.test(model.trim())
      ? model.trim().toLowerCase().replace(/\s+/g, "-")
      : model.trim();
    if (!isConfigValue(id)) return;
    this.#ids = [
      id,
      ...this.#ids.filter((known) => !sameModel(known, id)),
    ].slice(0, MAX_MODELS);
  }

  get list(): readonly string[] {
    return this.#ids;
  }
}
