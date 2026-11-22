import streamDeck, {
  action,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type SendToPluginEvent,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { codexController } from "../codex/controller";
import {
  type CatalogAdditions,
  catalogValuesOf,
  mergeCatalog,
} from "../domain/catalog";
import { shortcutController } from "../codex/shortcut-controller";
import {
  type ActionSettings,
  choicesFor,
  defaultsFor,
  type SettingsActionKind,
} from "../domain/settings";
import { STYLE_CYCLE } from "../domain/styles";
import { styleService } from "../ui/style-service";
import { catalogSync, logLinked } from "./catalog-sync";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function additionsFrom(payload: Record<string, unknown>): CatalogAdditions {
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter(isRecord) : [];
  return {
    efforts: list(payload.efforts).flatMap((item) =>
      typeof item.effort === "string"
        ? [
            {
              effort: item.effort,
              label: typeof item.label === "string" ? item.label : undefined,
            },
          ]
        : [],
    ),
    models: list(payload.models).flatMap((item) =>
      typeof item.model === "string"
        ? [
            {
              label: typeof item.label === "string" ? item.label : undefined,
              model: item.model,
            },
          ]
        : [],
    ),
  };
}

abstract class CodexAction extends SingletonAction<ActionSettings> {
  abstract readonly kind: SettingsActionKind;

  override async onWillAppear(
    event: WillAppearEvent<ActionSettings>,
  ): Promise<void> {
    if (!event.action.isKey()) return;
    const defaults = this.#withDefaults(event.payload.settings);
    const settings =
      mergeCatalog(this.kind, defaults, styleService.catalog) ?? defaults;
    logLinked(this.kind, defaults, settings);
    if (JSON.stringify(settings) !== JSON.stringify(event.payload.settings))
      await event.action.setSettings(settings);
    catalogSync.track(event.action, this.kind, settings);
    await codexController.show(event.action, this.kind, settings);
    await styleService
      .addToCatalog(catalogValuesOf(this.kind, settings))
      .catch(() => undefined);
  }

  override onWillDisappear(event: WillDisappearEvent<ActionSettings>): void {
    catalogSync.untrack(event.action.id);
    codexController.hide(event.action.id);
  }

  override async onDidReceiveSettings(
    event: DidReceiveSettingsEvent<ActionSettings>,
  ): Promise<void> {
    if (!event.action.isKey()) return;
    const settings = this.#withDefaults(event.payload.settings);
    catalogSync.track(event.action, this.kind, settings);
    await codexController.settingsChanged(event.action, this.kind, settings);
  }

  override async onKeyDown(event: KeyDownEvent<ActionSettings>): Promise<void> {
    if (!event.action.isKey()) return;
    await codexController.press(
      event.action,
      this.kind,
      this.#withDefaults(event.payload.settings),
    );
  }

  override async onSendToPlugin(
    event: SendToPluginEvent<JsonValue, ActionSettings>,
  ): Promise<void> {
    const payload = event.payload;
    if (isRecord(payload) && payload.type === "catalog/add") {
      await styleService.addToCatalog(additionsFrom(payload));
      return;
    }
    if (isRecord(payload) && payload.type === "state/get") {
      const state = await codexController.currentState();
      await streamDeck.ui.sendToPropertyInspector({
        type: "state/current",
        ...state,
      });
      return;
    }
    await styleService.handle(payload);
  }

  #withDefaults(settings: ActionSettings): ActionSettings {
    const result = structuredClone(
      Object.keys(settings).length === 0 ? defaultsFor(this.kind) : settings,
    );
    const key =
      this.kind === "model"
        ? "models"
        : this.kind === "thinking"
          ? "thinking"
          : "presets";
    if (this.kind === "single") {
      result.showNext = false;
      if (Array.isArray(result.presets))
        result.presets = result.presets.slice(0, 1).map((preset) => {
          const value = { ...preset };
          delete value.enabled;
          return value;
        });
    }
    const values = result[key];
    if (Array.isArray(values))
      for (const [index, value] of values.entries()) {
        if (value && typeof value === "object" && !value.styleId)
          value.styleId = STYLE_CYCLE[index % STYLE_CYCLE.length];
      }
    return result;
  }
}

@action({ UUID: "com.courcelle.codex-controls.shortcut" })
export class ShortcutAction extends SingletonAction<ActionSettings> {
  override async onWillAppear(
    event: WillAppearEvent<ActionSettings>,
  ): Promise<void> {
    if (!event.action.isKey()) return;
    const settings = withDefaults("shortcut", event.payload.settings);
    if (JSON.stringify(settings) !== JSON.stringify(event.payload.settings))
      await event.action.setSettings(settings);
    await shortcutController.show(event.action, settings);
  }

  override onWillDisappear(event: WillDisappearEvent<ActionSettings>): void {
    shortcutController.hide(event.action.id);
  }

  override async onDidReceiveSettings(
    event: DidReceiveSettingsEvent<ActionSettings>,
  ): Promise<void> {
    if (!event.action.isKey()) return;
    await shortcutController.settingsChanged(
      event.action,
      withDefaults("shortcut", event.payload.settings),
    );
  }

  override async onKeyDown(event: KeyDownEvent<ActionSettings>): Promise<void> {
    if (!event.action.isKey()) return;
    await shortcutController.press(
      event.action,
      withDefaults("shortcut", event.payload.settings),
    );
  }

  override async onSendToPlugin(
    event: SendToPluginEvent<JsonValue, ActionSettings>,
  ): Promise<void> {
    await styleService.handle(event.payload);
  }
}

function withDefaults(
  kind: "shortcut",
  settings: ActionSettings,
): ActionSettings {
  const result = structuredClone(
    Object.keys(settings).length === 0 ? defaultsFor(kind) : settings,
  );
  result.showNext = false;
  result.shortcuts = choicesFor("shortcut", result);
  const values = result.shortcuts;
  if (Array.isArray(values))
    for (const [index, value] of values.entries()) {
      if (value && typeof value === "object" && !value.styleId)
        value.styleId = STYLE_CYCLE[index % STYLE_CYCLE.length];
    }
  return result;
}

@action({ UUID: "com.courcelle.codex-controls.model" })
export class ModelAction extends CodexAction {
  readonly kind = "model" as const;
}

@action({ UUID: "com.courcelle.codex-controls.thinking" })
export class ThinkingAction extends CodexAction {
  readonly kind = "thinking" as const;
}

@action({ UUID: "com.courcelle.codex-controls.preset" })
export class PresetAction extends CodexAction {
  readonly kind = "preset" as const;
}

@action({ UUID: "com.courcelle.codex-controls.single-preset" })
export class SinglePresetAction extends CodexAction {
  readonly kind = "single" as const;
}
