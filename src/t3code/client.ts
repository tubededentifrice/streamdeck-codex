import type { FrontAppWatcher } from "../apps/front-app-watcher";
import { CodexError } from "../codex/errors";
import type { CodexState } from "../domain/settings";
import type {
  T3CodeServer,
  T3ModelOption,
  T3ModelSelection,
  T3ProviderCapabilities,
} from "./server";

export const T3CODE_HOST_ID = "t3code";

const ID = /^[A-Za-z0-9][A-Za-z0-9_:.-]{7,159}$/;
const EFFORT_OPTION = /effort/i;
const CAPABILITIES_TTL = 60_000;

type Watcher = Pick<FrontAppWatcher, "onChange" | "snapshot">;
type Server = Pick<
  T3CodeServer,
  "capabilities" | "environmentId" | "readSelection" | "writeSelection"
>;

export type T3Route = Readonly<{ environmentId: string; threadId: string }>;

export function parseT3Route(url: string | undefined): T3Route | undefined {
  if (!url) return undefined;
  let pathname: string;
  try {
    const parsed = new URL(url);
    pathname = parsed.hash.startsWith("#/")
      ? parsed.hash.slice(1).split("?")[0]
      : parsed.pathname;
  } catch {
    return undefined;
  }
  const match = /^\/(?:threads\/)?([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return undefined;
  const [environmentId, threadId] = match
    .slice(1)
    .map((part) => decodeURIComponent(part));
  if (!ID.test(environmentId) || !ID.test(threadId)) return undefined;
  return { environmentId, threadId };
}

function effortOf(selection: T3ModelSelection): string {
  const option = selection.options?.find((item) => EFFORT_OPTION.test(item.id));
  return typeof option?.value === "string" ? option.value : "default";
}

function error(
  code: ConstructorParameters<typeof CodexError>[0],
  message: string,
): CodexError {
  return new CodexError(code, message, { app: "t3code" });
}

export class T3CodeClient {
  readonly #listeners = new Set<() => void>();
  readonly #server: Server;
  readonly #watcher: Watcher;
  #capabilities:
    { expiresAt: number; value: Promise<T3ProviderCapabilities[]> } | undefined;
  #routeKey: string | undefined;
  #routeRevision = 0;

  constructor(watcher: Watcher, server: Server) {
    this.#watcher = watcher;
    this.#server = server;
    this.#syncRoute();
    watcher.onChange(() => {
      this.#syncRoute();
      for (const listener of this.#listeners) listener();
    });
  }

  get routeRevision(): number {
    return this.#routeRevision;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async readState(): Promise<CodexState> {
    const threadId = await this.#selectedThread();
    const selection = await this.#server.readSelection(threadId);
    return this.#state(threadId, selection);
  }

  async update(
    model: string,
    effort: string,
    expectedThreadId: string,
    expectedHostId: string,
  ): Promise<CodexState> {
    if (expectedHostId !== T3CODE_HOST_ID)
      throw new Error("The selected task changed before the update.");
    const threadId = await this.#selectedThread();
    if (threadId !== expectedThreadId)
      throw new Error("The selected task changed before the update.");
    const current = await this.#server.readSelection(threadId);
    const target = await this.#target(current, model, effort);
    await this.#server.writeSelection(threadId, target);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if ((await this.#selectedThread()) !== threadId)
        throw new Error("The selected task changed during the update.");
      const state = this.#state(
        threadId,
        await this.#server.readSelection(threadId),
      );
      if (state.model === model && state.effort === effort) {
        for (const listener of this.#listeners) listener();
        return state;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      "T3 Code did not save the requested model and thinking level.",
    );
  }

  #state(threadId: string, selection: T3ModelSelection): CodexState {
    return {
      effort: effortOf(selection),
      hostId: T3CODE_HOST_ID,
      model: selection.model,
      threadId,
    };
  }

  async #target(
    current: T3ModelSelection,
    model: string,
    effort: string,
  ): Promise<T3ModelSelection> {
    // A provider change on a started thread needs a T3 Code handoff, so a key
    // changes the model only within the thread's provider.
    const providers = await this.#providerCapabilities();
    const provider = providers.find(
      (p) => p.providerInstanceId === current.instanceId,
    );
    if (!provider || provider.models.length === 0)
      return this.#fallbackTarget(current, model, effort);
    const capability = provider.models.find((m) => m.id === model);
    if (!capability)
      throw new Error(
        providers.some((p) => p.models.some((m) => m.id === model))
          ? `The ${model} model needs another T3 Code provider.`
          : `T3 Code has no model ${model}.`,
      );
    const keep = new Map<string, unknown>(
      (current.options ?? []).map((option) => [option.id, option.value]),
    );
    const options: T3ModelOption[] = [];
    let effortSet = false;
    for (const option of capability.options ?? []) {
      const values = option.values ?? [];
      if (EFFORT_OPTION.test(option.id)) {
        effortSet = true;
        if (effort === "default") continue;
        if (values.length > 0 && !values.includes(effort))
          throw new Error(
            `The ${model} model does not support the ${effort} thinking choice.`,
          );
        options.push({ id: option.id, value: effort });
        continue;
      }
      if (keep.has(option.id) && values.includes(keep.get(option.id)))
        options.push({ id: option.id, value: keep.get(option.id) });
    }
    if (!effortSet && effort !== "default")
      throw new Error(`The ${model} model has no thinking choice.`);
    return { instanceId: current.instanceId, model, options };
  }

  /** T3 Code can list no models while a provider refreshes its catalog. */
  #fallbackTarget(
    current: T3ModelSelection,
    model: string,
    effort: string,
  ): T3ModelSelection {
    this.#capabilities = undefined;
    const options = [...(current.options ?? [])];
    const index = options.findIndex((option) => EFFORT_OPTION.test(option.id));
    const id =
      index >= 0
        ? options[index].id
        : /claude/i.test(current.instanceId)
          ? "effort"
          : "reasoningEffort";
    if (index >= 0) options.splice(index, 1);
    if (effort !== "default") options.push({ id, value: effort });
    return { instanceId: current.instanceId, model, options };
  }

  #providerCapabilities(): Promise<T3ProviderCapabilities[]> {
    const now = Date.now();
    if (!this.#capabilities || this.#capabilities.expiresAt <= now) {
      const value = this.#server.capabilities();
      this.#capabilities = { expiresAt: now + CAPABILITIES_TTL, value };
      value.catch(() => {
        if (this.#capabilities?.value === value) this.#capabilities = undefined;
      });
    }
    return this.#capabilities.value;
  }

  async #selectedThread(): Promise<string> {
    const snapshot = this.#watcher.snapshot;
    if (!snapshot.started)
      throw error("resolving-task", "T3 Code selection is loading.");
    if (!snapshot.accessibility)
      throw error(
        "accessibility",
        "Allow Stream Deck in macOS Accessibility settings to follow T3 Code.",
      );
    const route = parseT3Route(snapshot.t3Url);
    if (!route) throw error("resolving-task", "Open a T3 Code thread.");
    if (route.environmentId !== (await this.#server.environmentId()))
      throw error(
        "remote-task",
        "Codex Controls support only local T3 Code threads.",
      );
    return route.threadId;
  }

  #syncRoute(): void {
    const route = parseT3Route(this.#watcher.snapshot.t3Url);
    const key = route ? `${route.environmentId}\0${route.threadId}` : undefined;
    if (key === this.#routeKey) return;
    this.#routeKey = key;
    this.#routeRevision += 1;
  }
}
