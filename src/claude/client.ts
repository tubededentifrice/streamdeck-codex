import type { FrontAppWatcher } from "../apps/front-app-watcher";
import { CodexError } from "../codex/errors";
import { sameEffort, type CodexState } from "../domain/settings";
import { claudeModelId, claudeModelMatches, parseClaudeLabel } from "./labels";

export const CLAUDE_HOST_ID = "claude";
const VERIFY_TIMEOUT = 3000;

type Watcher = Pick<FrontAppWatcher, "onChange" | "snapshot">;
export type ComposerRunner = FrontAppWatcher["runComposer"];

export function isClaudeHostId(hostId: string): boolean {
  return hostId === CLAUDE_HOST_ID;
}

function error(
  code: ConstructorParameters<typeof CodexError>[0],
  message: string,
): CodexError {
  return new CodexError(code, message, { app: "claude" });
}

/** The page path identifies the chat or session: "/epitaxy/local_…". */
function threadIdFor(route: string): string {
  try {
    return new URL(route).pathname;
  } catch {
    return route;
  }
}

function stateFrom(route: string, label: string): CodexState {
  const parsed = parseClaudeLabel(label);
  if (!parsed) throw error("task-state-unavailable", "Claude shows no model.");
  return {
    effort: parsed.effort ?? "default",
    hostId: CLAUDE_HOST_ID,
    model: claudeModelId(parsed.model),
    threadId: threadIdFor(route),
  };
}

/**
 * Reads and changes the model and effort of the open Claude chat or Claude
 * Code session through the model button of its composer. The composer shows
 * the next-turn value, also for a new chat or session and for a cloud session.
 */
export class ClaudeClient {
  readonly #listeners = new Set<() => void>();
  readonly #run: ComposerRunner;
  readonly #watcher: Watcher;
  #routeKey: string | undefined;
  #routeRevision = 0;

  constructor(
    watcher: Watcher & Partial<Pick<FrontAppWatcher, "runComposer">>,
    run: ComposerRunner = (request) =>
      watcher.runComposer
        ? watcher.runComposer(request)
        : Promise.reject(new Error("Claude cannot apply the change.")),
  ) {
    this.#watcher = watcher;
    this.#run = run;
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
    const route = this.#selectedRoute();
    const label = this.#watcher.snapshot.claude.composer;
    if (!label) throw error("resolving-task", "Open a Claude chat.");
    return stateFrom(route, label);
  }

  async update(
    model: string,
    effort: string,
    expectedThreadId: string,
    expectedHostId: string,
  ): Promise<CodexState> {
    const route = this.#selectedRoute();
    const routeKey = this.#routeKey;
    if (
      threadIdFor(route) !== expectedThreadId ||
      !isClaudeHostId(expectedHostId)
    )
      throw new Error("The selected task changed before the update.");
    const page = this.#watcher.snapshot.claude;
    const label = await this.#run({
      app: "claude",
      composer: page.index,
      effort,
      model,
      route: page.route,
    });
    const deadline = Date.now() + VERIFY_TIMEOUT;
    // Claude keeps its own effort when the request has none.
    const done = (value: CodexState | undefined): value is CodexState =>
      value !== undefined &&
      claudeModelMatches(value.model, model) &&
      (effort === "default" || sameEffort(value.effort, effort));
    let state = label ? stateFrom(route, label) : undefined;
    while (!done(state)) {
      if (this.#routeKey !== routeKey)
        throw new Error("The selected task changed during the update.");
      if (Date.now() >= deadline)
        throw new Error(
          "Claude did not show the requested model and thinking level.",
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
      const current = this.#watcher.snapshot.claude.composer;
      state = current ? stateFrom(route, current) : undefined;
    }
    for (const listener of this.#listeners) listener();
    return state;
  }

  #selectedRoute(): string {
    const snapshot = this.#watcher.snapshot;
    if (!snapshot.started)
      throw error("resolving-task", "Claude selection is loading.");
    if (!snapshot.accessibility)
      throw error(
        "accessibility",
        "Allow Stream Deck in macOS Accessibility settings to follow Claude.",
      );
    const route = snapshot.claude.route;
    if (!route) throw error("resolving-task", "Open a Claude chat.");
    return route;
  }

  #syncRoute(): void {
    const page = this.#watcher.snapshot.claude;
    const key = page.route ? `${page.route}\0${page.index}` : undefined;
    if (key === this.#routeKey) return;
    this.#routeKey = key;
    this.#routeRevision += 1;
  }
}
