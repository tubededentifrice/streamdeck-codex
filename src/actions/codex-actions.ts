import {
  action,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";

import { codexController } from "../codex/controller";
import {
  type ActionKind,
  type ActionSettings,
  defaultsFor,
} from "../domain/settings";

abstract class CodexAction extends SingletonAction<ActionSettings> {
  abstract readonly kind: ActionKind;

  override async onWillAppear(
    event: WillAppearEvent<ActionSettings>,
  ): Promise<void> {
    if (!event.action.isKey()) return;
    const settings = this.#withDefaults(event.payload.settings);
    if (Object.keys(event.payload.settings).length === 0)
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

  #withDefaults(settings: ActionSettings): ActionSettings {
    return Object.keys(settings).length === 0
      ? defaultsFor(this.kind)
      : settings;
  }
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
