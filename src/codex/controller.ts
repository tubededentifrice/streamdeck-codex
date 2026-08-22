import streamDeck, { type KeyAction } from "@elgato/streamdeck";

import type {
  ActionKind,
  ActionSettings,
  CodexState,
} from "../domain/settings";
import { choicesFor, nextChoice, targetState } from "../domain/settings";
import { renderError, renderKey, renderLoading } from "../ui/key-renderer";
import { CodexDesktopClient } from "./desktop-client";

type VisibleAction = {
  action: KeyAction<ActionSettings>;
  kind: ActionKind;
  settings: ActionSettings;
};

class CodexController {
  readonly #client = new CodexDesktopClient();
  readonly #busy = new Set<string>();
  readonly #visible = new Map<string, VisibleAction>();
  #refreshPromise: Promise<void> | undefined;
  #refreshRequested = false;
  #updatePromise: Promise<void> = Promise.resolve();

  start(): void {
    this.#client.onChange(() => this.#refreshInBackground());
    setInterval(() => this.#refreshInBackground(), 2000).unref();
  }

  show(
    action: KeyAction<ActionSettings>,
    kind: ActionKind,
    settings: ActionSettings,
  ): Promise<void> {
    this.#visible.set(action.id, { action, kind, settings });
    return this.refreshAll();
  }

  hide(actionId: string): void {
    this.#visible.delete(actionId);
  }

  settingsChanged(
    action: KeyAction<ActionSettings>,
    kind: ActionKind,
    settings: ActionSettings,
  ): Promise<void> {
    this.#visible.set(action.id, { action, kind, settings });
    return this.refreshAll();
  }

  press(
    action: KeyAction<ActionSettings>,
    kind: ActionKind,
    settings: ActionSettings,
  ): Promise<void> {
    this.#updatePromise = this.#updatePromise
      .catch(() => undefined)
      .then(async () => {
        this.#busy.add(action.id);
        await this.#setImage(action, renderLoading(kind));
        let changed = false;
        try {
          const current = await this.#client.readState();
          const choice = nextChoice(kind as "preset", settings, current);
          if (!choice)
            throw new Error(
              "Add at least one valid choice in the key settings.",
            );
          const target = targetState(kind, choice, current);
          const updated = await this.#client.update(
            target.model,
            target.effort,
            current.threadId,
            current.hostId,
          );
          changed = true;
          await this.#blinkBorder(action, kind, settings, updated);
        } catch (error) {
          streamDeck.logger.error("Codex setting update failed.");
          await this.#setImage(action, renderError(kind, error));
          await this.#showAlert(action);
        } finally {
          this.#busy.delete(action.id);
        }
        if (changed) await this.refreshAll();
      });
    return this.#updatePromise;
  }

  refreshAll(): Promise<void> {
    this.#refreshRequested = true;
    if (this.#refreshPromise) return this.#refreshPromise;
    this.#refreshPromise = this.#drainRefreshes().finally(() => {
      this.#refreshPromise = undefined;
      if (this.#refreshRequested) this.#refreshInBackground();
    });
    return this.#refreshPromise;
  }

  async #drainRefreshes(): Promise<void> {
    while (this.#refreshRequested) {
      this.#refreshRequested = false;
      await this.#refresh();
    }
  }

  #refreshInBackground(): void {
    void this.refreshAll().catch(() => {
      streamDeck.logger.error("Codex key refresh failed.");
    });
  }

  async #refresh(): Promise<void> {
    if (this.#visible.size === 0) return;
    let state: CodexState;
    try {
      state = await this.#client.readState();
    } catch (error) {
      await Promise.all(
        [...this.#visible.values()].map(({ action, kind }) =>
          this.#busy.has(action.id)
            ? Promise.resolve()
            : this.#setImage(action, renderError(kind, error)),
        ),
      );
      return;
    }

    await Promise.all(
      [...this.#visible.values()].map(async ({ action, kind, settings }) => {
        if (this.#busy.has(action.id)) return;
        const count = choicesFor(kind as "preset", settings).length;
        const next = nextChoice(kind as "preset", settings, state);
        await this.#setImage(action, renderKey(kind, state, next, count));
      }),
    );
  }

  async #setImage(
    action: KeyAction<ActionSettings>,
    image: string,
  ): Promise<void> {
    if (this.#visible.get(action.id)?.action !== action) return;
    try {
      await action.setImage(image);
    } catch {
      streamDeck.logger.error("Stream Deck did not accept a key image.");
    }
  }

  async #showAlert(action: KeyAction<ActionSettings>): Promise<void> {
    if (this.#visible.get(action.id)?.action !== action) return;
    try {
      await action.showAlert();
    } catch {
      streamDeck.logger.error("Stream Deck did not accept key feedback.");
    }
  }

  async #blinkBorder(
    action: KeyAction<ActionSettings>,
    kind: ActionKind,
    settings: ActionSettings,
    state: CodexState,
  ): Promise<void> {
    const count = choicesFor(kind as "preset", settings).length;
    const next = nextChoice(kind as "preset", settings, state);
    const normal = renderKey(kind, state, next, count);
    const bright = renderKey(kind, state, next, count, "#ffffff");
    for (let blink = 0; blink < 3; blink += 1) {
      await this.#setImage(action, bright);
      await new Promise((resolve) => setTimeout(resolve, 55));
      await this.#setImage(action, normal);
      if (blink < 2) await new Promise((resolve) => setTimeout(resolve, 55));
    }
  }
}

export const codexController = new CodexController();
