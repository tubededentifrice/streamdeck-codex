import streamDeck, { type KeyAction } from "@elgato/streamdeck";

import { codexController } from "../codex/controller";
import { mergeCatalog } from "../domain/catalog";
import type { ActionSettings, SettingsActionKind } from "../domain/settings";
import { styleService } from "../ui/style-service";

type Tracked = {
  action: KeyAction<ActionSettings>;
  kind: SettingsActionKind;
  settings: ActionSettings;
};

export function logLinked(
  kind: SettingsActionKind,
  before: ActionSettings,
  after: ActionSettings,
): void {
  const key = kind === "model" ? "models" : "thinking";
  const added =
    (Array.isArray(after[key]) ? after[key].length : 0) -
    (Array.isArray(before[key]) ? before[key].length : 0);
  if (added > 0)
    streamDeck.logger.info(`Linked ${added} value(s) to a ${kind} key.`);
}

/** Adds new catalog values to every visible setting key. */
class CatalogSync {
  readonly #tracked = new Map<string, Tracked>();

  start(): void {
    styleService.onCatalogChange(() => {
      void this.#mergeAll().catch(() => {
        streamDeck.logger.error("Linked key values could not be saved.");
      });
    });
  }

  track(
    action: KeyAction<ActionSettings>,
    kind: SettingsActionKind,
    settings: ActionSettings,
  ): void {
    this.#tracked.set(action.id, { action, kind, settings });
  }

  untrack(actionId: string): void {
    this.#tracked.delete(actionId);
  }

  async #mergeAll(): Promise<void> {
    const catalog = styleService.catalog;
    for (const entry of this.#tracked.values()) {
      const merged = mergeCatalog(entry.kind, entry.settings, catalog);
      if (!merged) continue;
      logLinked(entry.kind, entry.settings, merged);
      entry.settings = merged;
      await entry.action.setSettings(merged);
      await codexController.settingsChanged(entry.action, entry.kind, merged);
    }
  }
}

export const catalogSync = new CatalogSync();
