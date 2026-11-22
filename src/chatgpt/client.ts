import type { FrontAppWatcher } from "../apps/front-app-watcher";
import { CodexError } from "../codex/errors";
import { sameEffort, sameModel, type CodexState } from "../domain/settings";
import { parseChatGPTLabel } from "./labels";
import { ChatGPTModelNames } from "./model-names";

export const CHATGPT_HOST_ID = "chatgpt";
const VERIFY_TIMEOUT = 3000;

type Watcher = Pick<FrontAppWatcher, "onChange" | "snapshot">;
export type ComposerRunner = FrontAppWatcher["runComposer"];
type ModelNames = Pick<ChatGPTModelNames, "idFor">;

export function isChatGPTHostId(hostId: string): boolean {
  return hostId === CHATGPT_HOST_ID;
}

function error(
  code: ConstructorParameters<typeof CodexError>[0],
  message: string,
): CodexError {
  return new CodexError(code, message, { app: "chatgpt" });
}

function stateFrom(
  title: string,
  label: string,
  names: ModelNames,
): CodexState {
  const parsed = parseChatGPTLabel(label);
  if (!parsed) throw error("task-state-unavailable", "ChatGPT shows no model.");
  return {
    effort: parsed.effort ?? "default",
    hostId: CHATGPT_HOST_ID,
    model: names.idFor(parsed.model),
    threadId: title,
  };
}

/**
 * Reads and changes the model of the open ChatGPT chat through the model
 * button of its composer. The composer shows the next-turn value for a new
 * chat, a local or remote chat, and a side chat. The ChatGPT window does not
 * expose the chat ID, so the window title identifies the chat.
 */
export class ChatGPTClient {
  readonly #listeners = new Set<() => void>();
  readonly #names: ModelNames;
  readonly #run: ComposerRunner;
  readonly #watcher: Watcher;
  #routeKey: string | undefined;
  #routeRevision = 0;

  constructor(
    watcher: Watcher & Partial<Pick<FrontAppWatcher, "runComposer">>,
    run: ComposerRunner = (request) =>
      watcher.runComposer
        ? watcher.runComposer(request)
        : Promise.reject(new Error("ChatGPT cannot apply the change.")),
    names: ModelNames = new ChatGPTModelNames(),
  ) {
    this.#watcher = watcher;
    this.#run = run;
    this.#names = names;
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
    const title = this.#selectedTitle();
    const label = this.#watcher.snapshot.chatgpt.composer;
    if (!label) throw error("resolving-task", "Open a ChatGPT chat.");
    return stateFrom(title, label, this.#names);
  }

  async update(
    model: string,
    effort: string,
    expectedThreadId: string,
    expectedHostId: string,
  ): Promise<CodexState> {
    const title = this.#selectedTitle();
    const routeKey = this.#routeKey;
    if (title !== expectedThreadId || !isChatGPTHostId(expectedHostId))
      throw new Error("The selected task changed before the update.");
    const page = this.#watcher.snapshot.chatgpt;
    const label = await this.#run({
      app: "chatgpt",
      composer: page.index,
      effort,
      model,
      route: page.route,
    });
    const deadline = Date.now() + VERIFY_TIMEOUT;
    let state = label ? stateFrom(title, label, this.#names) : undefined;
    while (
      !state ||
      !sameModel(state.model, model) ||
      !sameEffort(state.effort, effort)
    ) {
      if (this.#routeKey !== routeKey)
        throw new Error("The selected task changed during the update.");
      if (Date.now() >= deadline)
        throw new Error(
          "ChatGPT did not show the requested model and thinking level.",
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
      const current = this.#watcher.snapshot.chatgpt.composer;
      state = current ? stateFrom(title, current, this.#names) : undefined;
    }
    for (const listener of this.#listeners) listener();
    return state;
  }

  #selectedTitle(): string {
    const snapshot = this.#watcher.snapshot;
    if (!snapshot.started)
      throw error("resolving-task", "ChatGPT selection is loading.");
    if (!snapshot.accessibility)
      throw error(
        "accessibility",
        "Allow Stream Deck in macOS Accessibility settings to follow ChatGPT.",
      );
    const title = snapshot.chatgpt.route;
    if (!title) throw error("resolving-task", "Open a ChatGPT chat.");
    return title;
  }

  #syncRoute(): void {
    const page = this.#watcher.snapshot.chatgpt;
    const key = page.route ? `${page.route}\0${page.index}` : undefined;
    if (key === this.#routeKey) return;
    this.#routeKey = key;
    this.#routeRevision += 1;
  }
}
