import crypto from "node:crypto";

import streamDeck from "@elgato/streamdeck";

import {
  BUILT_IN_STYLES,
  type KeyStyle,
  type PluginGlobalSettings,
  sanitizeCustomStyles,
} from "../domain/styles";
import { sanitizeCodexRoute, type CodexRoute } from "../domain/route";

type StyleMessage =
  | { type: "styles/delete"; id?: unknown }
  | { type: "styles/get" }
  | { type: "styles/upsert"; style?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class StyleService {
  readonly #listeners = new Set<() => void>();
  #settings: PluginGlobalSettings = {};
  #writePromise: Promise<void> = Promise.resolve();

  get settings(): PluginGlobalSettings {
    return this.#settings;
  }

  get lastRoute(): CodexRoute | undefined {
    return sanitizeCodexRoute(this.#settings.lastRoute);
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async start(): Promise<void> {
    streamDeck.settings.onDidReceiveGlobalSettings<PluginGlobalSettings>(
      (event) => this.#apply(event.settings),
    );
    this.#apply(
      await streamDeck.settings.getGlobalSettings<PluginGlobalSettings>(),
    );
  }

  async handle(payload: unknown): Promise<void> {
    if (!isRecord(payload) || typeof payload.type !== "string") return;
    const message = payload as StyleMessage;
    try {
      if (message.type === "styles/get") {
        await this.#sendCatalog();
        return;
      }
      if (message.type === "styles/delete") {
        await this.#delete(message.id);
        return;
      }
      if (message.type === "styles/upsert") {
        await this.#upsert(message.style);
      }
    } catch (error) {
      await this.#sendError(
        error instanceof Error ? error.message : "Could not save the preset.",
      );
    }
  }

  saveLastRoute(route: CodexRoute | undefined): Promise<void> {
    const sanitized = sanitizeCodexRoute(route);
    const current = this.lastRoute;
    if (
      current?.hostId === sanitized?.hostId &&
      current?.threadId === sanitized?.threadId
    )
      return Promise.resolve();
    return this.#updateSettings((settings) => ({
      ...settings,
      lastRoute: sanitized,
    }));
  }

  #apply(settings: PluginGlobalSettings): void {
    this.#settings = {
      ...settings,
      customStyles: sanitizeCustomStyles(settings.customStyles),
    };
    for (const listener of this.#listeners) listener();
  }

  async #save(customStyles: KeyStyle[]): Promise<void> {
    await this.#updateSettings((settings) => ({ ...settings, customStyles }));
    await this.#sendCatalog();
  }

  #updateSettings(
    update: (settings: PluginGlobalSettings) => PluginGlobalSettings,
  ): Promise<void> {
    this.#writePromise = this.#writePromise
      .catch(() => undefined)
      .then(async () => {
        const settings = update(this.#settings);
        await streamDeck.settings.setGlobalSettings(settings);
        this.#apply(settings);
      });
    return this.#writePromise;
  }

  async #delete(id: unknown): Promise<void> {
    if (typeof id !== "string" || !id.startsWith("custom:"))
      throw new Error("Select a custom preset to delete.");
    const styles = sanitizeCustomStyles(this.#settings.customStyles);
    if (!styles.some((style) => style.id === id))
      throw new Error("The custom preset does not exist.");
    await this.#save(styles.filter((style) => style.id !== id));
  }

  async #upsert(value: unknown): Promise<void> {
    if (!isRecord(value)) throw new Error("The color preset is invalid.");
    const styles = sanitizeCustomStyles(this.#settings.customStyles);
    const requestedId = typeof value.id === "string" ? value.id : undefined;
    if (requestedId && !styles.some((style) => style.id === requestedId))
      throw new Error("The custom preset does not exist.");
    const id = requestedId ?? `custom:${crypto.randomUUID()}`;
    const candidate = sanitizeCustomStyles([{ ...value, id }])[0];
    if (!candidate)
      throw new Error("Enter a name and three valid six-digit colors.");
    const next = requestedId
      ? styles.map((style) => (style.id === requestedId ? candidate : style))
      : [...styles, candidate];
    if (!requestedId && next.length > 64)
      throw new Error("You can save up to 64 custom presets.");
    await this.#save(next);
  }

  async #sendCatalog(): Promise<void> {
    await streamDeck.ui.sendToPropertyInspector({
      builtInStyles: BUILT_IN_STYLES.map((style) => ({ ...style })),
      customStyles: sanitizeCustomStyles(this.#settings.customStyles),
      type: "styles/catalog",
    });
  }

  async #sendError(message: string): Promise<void> {
    await streamDeck.ui.sendToPropertyInspector({
      message,
      type: "styles/error",
    });
  }
}

export const styleService = new StyleService();
