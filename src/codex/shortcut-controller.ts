import streamDeck, { type KeyAction } from "@elgato/streamdeck";

import {
  choicesFor,
  type ActionSettings,
  type ShortcutChoice,
} from "../domain/settings";
import { resolveStyleById } from "../domain/styles";
import {
  renderError,
  renderLoading,
  renderShortcutKey,
} from "../ui/key-renderer";
import { styleService } from "../ui/style-service";
import { shortcutLauncher } from "./shortcut-launcher";

type VisibleShortcut = {
  action: KeyAction<ActionSettings>;
  settings: ActionSettings;
};

type Launcher = Pick<typeof shortcutLauncher, "open">;
type ShortcutStyles = Pick<typeof styleService, "onChange" | "settings">;

export class ShortcutController {
  readonly #busy = new Set<string>();
  readonly #launcher: Launcher;
  readonly #styles: ShortcutStyles;
  readonly #visible = new Map<string, VisibleShortcut>();

  constructor(
    launcher: Launcher = shortcutLauncher,
    styles: ShortcutStyles = styleService,
  ) {
    this.#launcher = launcher;
    this.#styles = styles;
  }

  start(): void {
    this.#styles.onChange(() => this.#refreshAll());
  }

  async show(
    action: KeyAction<ActionSettings>,
    settings: ActionSettings,
  ): Promise<void> {
    this.#visible.set(action.id, { action, settings });
    await this.#render(action.id);
  }

  hide(actionId: string): void {
    this.#visible.delete(actionId);
  }

  async settingsChanged(
    action: KeyAction<ActionSettings>,
    settings: ActionSettings,
  ): Promise<void> {
    this.#visible.set(action.id, { action, settings });
    await this.#render(action.id);
  }

  async press(
    action: KeyAction<ActionSettings>,
    settings: ActionSettings,
  ): Promise<void> {
    const visible = this.#visible.get(action.id);
    if (!visible || visible.action !== action || this.#busy.has(action.id))
      return;
    this.#busy.add(action.id);
    visible.settings = settings;
    const choices = choicesFor("shortcut", settings);
    if (choices.length === 0) {
      await this.#setImage(
        visible,
        renderError(
          "shortcut",
          new Error("Select a valid shortcut in the key settings."),
          "update",
          settings,
        ),
      );
      await this.#showAlert(visible);
      this.#busy.delete(action.id);
      return;
    }
    const current = choices[0];
    await this.#setImage(
      visible,
      renderLoading("shortcut", "OPENING…", settings),
    );
    try {
      await this.#launcher.open(current.shortcut);
      await this.#blink(visible, current);
      streamDeck.logger.info(`Codex ${current.shortcut} shortcut opened.`);
    } catch (error) {
      streamDeck.logger.error("Codex shortcut failed to open.");
      await this.#setImage(
        visible,
        renderError("shortcut", error, "update", settings),
      );
      await this.#showAlert(visible);
    } finally {
      this.#busy.delete(action.id);
    }
  }

  #refreshAll(): void {
    for (const actionId of this.#visible.keys()) {
      void this.#render(actionId).catch(() => {
        streamDeck.logger.error("Codex shortcut key refresh failed.");
      });
    }
  }

  async #render(actionId: string): Promise<void> {
    const visible = this.#visible.get(actionId);
    if (!visible) return;
    const choices = choicesFor("shortcut", visible.settings);
    if (choices.length === 0) {
      await this.#setImage(
        visible,
        renderError(
          "shortcut",
          new Error("Select a valid shortcut in the key settings."),
          "refresh",
          visible.settings,
        ),
      );
      return;
    }
    await this.#setImage(visible, this.#image(visible, choices[0]));
  }

  #image(
    visible: VisibleShortcut,
    choice: ShortcutChoice,
    borderColor?: string,
  ): string {
    const style = resolveStyleById(choice.styleId, this.#styles.settings);
    return renderShortcutKey(choice, style, borderColor, visible.settings);
  }

  async #blink(
    visible: VisibleShortcut,
    choice: ShortcutChoice,
  ): Promise<void> {
    const normal = this.#image(visible, choice);
    const bright = this.#image(visible, choice, "#ffffff");
    for (let blink = 0; blink < 3; blink += 1) {
      await this.#setImage(visible, bright);
      await new Promise((resolve) => setTimeout(resolve, 55));
      await this.#setImage(visible, normal);
      if (blink < 2) await new Promise((resolve) => setTimeout(resolve, 55));
    }
  }

  async #setImage(visible: VisibleShortcut, image: string): Promise<void> {
    if (this.#visible.get(visible.action.id) !== visible) return;
    try {
      await visible.action.setImage(image);
    } catch {
      streamDeck.logger.error("Stream Deck did not accept a shortcut image.");
    }
  }

  async #showAlert(visible: VisibleShortcut): Promise<void> {
    if (this.#visible.get(visible.action.id) !== visible) return;
    try {
      await visible.action.showAlert();
    } catch {
      streamDeck.logger.error("Stream Deck did not accept shortcut feedback.");
    }
  }
}

export const shortcutController = new ShortcutController();
