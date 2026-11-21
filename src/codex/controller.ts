import streamDeck, { type KeyAction } from "@elgato/streamdeck";

import type {
  ActionSettings,
  CodexState,
  SettingsActionKind,
} from "../domain/settings";
import {
  choicesFor,
  displayChoice,
  nextChoice,
  targetState,
} from "../domain/settings";
import { activeStyleFor } from "../domain/styles";
import { renderError, renderKey, renderLoading } from "../ui/key-renderer";
import { styleService } from "../ui/style-service";
import { AgentClient } from "../apps/agent-client";
import { frontAppWatcher } from "../apps/front-app-watcher";
import { T3CodeClient } from "../t3code/client";
import { CodexDesktopClient } from "./desktop-client";
import { CodexError, isResolvingTaskError } from "./errors";

type VisibleAction = {
  action: KeyAction<ActionSettings>;
  kind: SettingsActionKind;
  settings: ActionSettings;
};

type ControllerClient = Pick<
  CodexDesktopClient,
  "onChange" | "readState" | "restoreRoute" | "routeRevision" | "update"
>;

type ControllerStyles = Pick<
  typeof styleService,
  "lastRoute" | "onChange" | "saveLastRoute" | "settings"
>;

export class CodexController {
  readonly #client: ControllerClient;
  readonly #styles: ControllerStyles;
  readonly #busy = new Map<
    string,
    { operation: symbol; routeRevision: number }
  >();
  readonly #updates = new Map<string, Promise<void>>();
  readonly #visible = new Map<string, VisibleAction>();
  #lastRefreshError: string | undefined;
  #refreshVersion = 0;

  constructor(
    client?: ControllerClient,
    styles: ControllerStyles = styleService,
  ) {
    this.#styles = styles;
    this.#client =
      client ??
      new AgentClient(
        new CodexDesktopClient(undefined, (route) => {
          void styles.saveLastRoute(route).catch(() => {
            streamDeck.logger.error(
              "Codex selected-task route could not be saved.",
            );
          });
        }),
        new T3CodeClient(frontAppWatcher),
        frontAppWatcher,
      );
  }

  start(): void {
    this.#client.restoreRoute(this.#styles.lastRoute);
    this.#client.onChange(() => this.#refreshInBackground());
    this.#styles.onChange(() => this.#refreshInBackground());
    setInterval(() => this.#refreshInBackground(), 2000).unref();
    this.#refreshInBackground();
  }

  show(
    action: KeyAction<ActionSettings>,
    kind: SettingsActionKind,
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
    kind: SettingsActionKind,
    settings: ActionSettings,
  ): Promise<void> {
    this.#visible.set(action.id, { action, kind, settings });
    return this.refreshAll();
  }

  async press(
    action: KeyAction<ActionSettings>,
    kind: SettingsActionKind,
    settings: ActionSettings,
  ): Promise<void> {
    const routeRevision = this.#client.routeRevision;
    const operation = Symbol(action.id);
    this.#busy.set(action.id, { operation, routeRevision });
    await this.#setImage(action, renderLoading(kind, undefined, settings));
    try {
      const selected = await this.#client.readState();
      if (routeRevision !== this.#client.routeRevision)
        throw new CodexError(
          "resolving-task",
          "The selected task changed before the update.",
        );
      const routeKey = `${selected.hostId}\0${selected.threadId}`;
      const updated = await this.#runRouteUpdate(routeKey, async () => {
        if (routeRevision !== this.#client.routeRevision)
          throw new CodexError(
            "resolving-task",
            "The selected task changed before the update.",
          );
        const current = await this.#client.readState();
        if (
          current.threadId !== selected.threadId ||
          current.hostId !== selected.hostId ||
          routeRevision !== this.#client.routeRevision
        )
          throw new CodexError(
            "resolving-task",
            "The selected task changed before the update.",
          );
        const choice = nextChoice(kind as "preset", settings, current);
        if (!choice)
          throw new Error("Add at least one valid choice in the key settings.");
        const target = targetState(kind, choice, current);
        return this.#client.update(
          target.model,
          target.effort,
          current.threadId,
          current.hostId,
        );
      });
      if (
        this.#busy.get(action.id)?.operation === operation &&
        routeRevision === this.#client.routeRevision
      ) {
        await this.#blinkBorder(action, kind, settings, updated);
        streamDeck.logger.info("Codex setting update verified.");
      }
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown update error.";
      if (
        this.#busy.get(action.id)?.operation === operation &&
        routeRevision === this.#client.routeRevision
      ) {
        streamDeck.logger.error(`Codex setting update failed: ${detail}`);
        await this.#setImage(
          action,
          renderError(kind, error, "update", settings),
        );
        await this.#showAlert(action);
      } else {
        streamDeck.logger.info(
          "Codex discarded update feedback after the selected task changed.",
        );
      }
    } finally {
      if (this.#busy.get(action.id)?.operation === operation)
        this.#busy.delete(action.id);
      await this.refreshAll();
    }
  }

  refreshAll(): Promise<void> {
    const version = ++this.#refreshVersion;
    return this.#refresh(version);
  }

  #refreshInBackground(): void {
    void this.refreshAll().catch(() => {
      streamDeck.logger.error("Codex key refresh failed.");
    });
  }

  async #refresh(version: number): Promise<void> {
    if (this.#visible.size === 0) return;
    const routeRevision = this.#client.routeRevision;
    let state: CodexState;
    try {
      state = await this.#client.readState();
    } catch (error) {
      if (
        version === this.#refreshVersion &&
        routeRevision === this.#client.routeRevision &&
        isResolvingTaskError(error)
      ) {
        await Promise.all(
          [...this.#visible.values()].map(({ action, kind, settings }) =>
            this.#busy.get(action.id)?.routeRevision === routeRevision
              ? Promise.resolve()
              : this.#setImage(
                  action,
                  renderLoading(kind, "NOT IN ACTIVE CHAT", settings),
                ),
          ),
        );
        return;
      }
      if (
        version !== this.#refreshVersion ||
        routeRevision !== this.#client.routeRevision
      )
        return;
      const detail =
        error instanceof Error ? error.message : "Unknown refresh error.";
      if (detail !== this.#lastRefreshError) {
        this.#lastRefreshError = detail;
        streamDeck.logger.error(`Codex key refresh failed: ${detail}`);
      }
      await Promise.all(
        [...this.#visible.values()].map(({ action, kind, settings }) =>
          this.#busy.get(action.id)?.routeRevision === routeRevision
            ? Promise.resolve()
            : this.#setImage(
                action,
                renderError(kind, error, "refresh", settings),
              ),
        ),
      );
      return;
    }
    if (
      version !== this.#refreshVersion ||
      routeRevision !== this.#client.routeRevision
    )
      return;
    this.#lastRefreshError = undefined;

    await Promise.all(
      [...this.#visible.values()].map(async ({ action, kind, settings }) => {
        if (this.#busy.get(action.id)?.routeRevision === routeRevision) return;
        const count = choicesFor(kind as "preset", settings).length;
        const next = nextChoice(kind as "preset", settings, state);
        const current = displayChoice(kind, settings, state);
        const style = activeStyleFor(
          kind,
          settings,
          state,
          this.#styles.settings,
        );
        await this.#setImage(
          action,
          renderKey(
            kind,
            state,
            next,
            count,
            style,
            undefined,
            settings,
            current,
          ),
        );
      }),
    );
  }

  #runRouteUpdate<T>(routeKey: string, update: () => Promise<T>): Promise<T> {
    const previous = this.#updates.get(routeKey) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(update);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.#updates.set(routeKey, settled);
    void settled.finally(() => {
      if (this.#updates.get(routeKey) === settled)
        this.#updates.delete(routeKey);
    });
    return result;
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
    kind: SettingsActionKind,
    settings: ActionSettings,
    state: CodexState,
  ): Promise<void> {
    const count = choicesFor(kind as "preset", settings).length;
    const next = nextChoice(kind as "preset", settings, state);
    const current = displayChoice(kind, settings, state);
    const style = activeStyleFor(kind, settings, state, this.#styles.settings);
    const normal = renderKey(
      kind,
      state,
      next,
      count,
      style,
      undefined,
      settings,
      current,
    );
    const bright = renderKey(
      kind,
      state,
      next,
      count,
      style,
      "#ffffff",
      settings,
      current,
    );
    for (let blink = 0; blink < 3; blink += 1) {
      await this.#setImage(action, bright);
      await new Promise((resolve) => setTimeout(resolve, 55));
      await this.#setImage(action, normal);
      if (blink < 2) await new Promise((resolve) => setTimeout(resolve, 55));
    }
  }
}

export const codexController = new CodexController();
