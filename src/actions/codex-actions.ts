import {
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
import { shortcutController } from "../codex/shortcut-controller";
import {
  type ActionSettings,
  choicesFor,
  defaultsFor,
  type SettingsActionKind,
} from "../domain/settings";
import { BUILT_IN_STYLES } from "../domain/styles";
import { styleService } from "../ui/style-service";

abstract class CodexAction extends SingletonAction<ActionSettings> {
  abstract readonly kind: SettingsActionKind;

  override async onWillAppear(
    event: WillAppearEvent<ActionSettings>,
  ): Promise<void> {
    if (!event.action.isKey()) return;
    const settings = this.#withDefaults(event.payload.settings);
    if (JSON.stringify(settings) !== JSON.stringify(event.payload.settings))
      await event.action.setSettings(settings);
    await codexController.show(event.action, this.kind, settings);
  }

  override onWillDisappear(event: WillDisappearEvent<ActionSettings>): void {
    codexController.hide(event.action.id);
  }

  override async onDidReceiveSettings(
    event: DidReceiveSettingsEvent<ActionSettings>,
  ): Promise<void> {
    if (!event.action.isKey()) return;
    await codexController.settingsChanged(
      event.action,
      this.kind,
      this.#withDefaults(event.payload.settings),
    );
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
    await styleService.handle(event.payload);
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
    const values = result[key];
    if (Array.isArray(values))
      for (const [index, value] of values.entries()) {
        if (value && typeof value === "object" && !value.styleId)
          value.styleId = BUILT_IN_STYLES[index % BUILT_IN_STYLES.length].id;
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
        value.styleId = BUILT_IN_STYLES[index % BUILT_IN_STYLES.length].id;
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
