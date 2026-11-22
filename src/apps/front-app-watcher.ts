import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ShortcutId } from "../domain/settings";
import { FRONT_APP_SCRIPT } from "./front-app-script";

export const CLAUDE_BUNDLE_ID = "com.anthropic.claudefordesktop";
export const CODEX_BUNDLE_ID = "com.openai.codex";
export const T3CODE_BUNDLE_ID = "com.t3tools.t3code";

export type AgentApp = "chatgpt" | "claude" | "codex" | "t3code";
/** An app whose composer the plug-in reads and changes through its window. */
export type ComposerApp = "chatgpt" | "claude" | "t3code";

/** ChatGPT for macOS uses the bundle ID of Codex desktop. */
export const APP_BUNDLE_IDS: Readonly<Record<AgentApp, string>> = Object.freeze(
  {
    chatgpt: CODEX_BUNDLE_ID,
    claude: CLAUDE_BUNDLE_ID,
    codex: CODEX_BUNDLE_ID,
    t3code: T3CODE_BUNDLE_ID,
  },
);

export const APP_NAMES: Readonly<Record<AgentApp, string>> = Object.freeze({
  chatgpt: "ChatGPT",
  claude: "Claude",
  codex: "Codex",
  t3code: "T3 Code",
});

export type ComposerPage = Readonly<{
  /** The model button label, such as "GPT-6.2-Sol, High · Standard". */
  composer: string | undefined;
  /** The composer that the keys follow: 0 for the thread, 1 for a side chat. */
  index: number;
  /** The open thread: the T3 Code or Claude page URL, or the ChatGPT window title. */
  route: string | undefined;
}>;

export type FrontAppSnapshot = Readonly<{
  /** The last frontmost supported app. Stream Deck does not take focus. */
  app: AgentApp | undefined;
  accessibility: boolean;
  chatgpt: ComposerPage;
  claude: ComposerPage;
  started: boolean;
  t3code: ComposerPage;
}>;

type Spawn = (
  command: string,
  args: readonly string[],
) => Pick<ChildProcess, "kill" | "on" | "stderr" | "stdin" | "stdout">;

const RESTART_INTERVAL = 30 * 60 * 1000;
const RETRY_DELAY = 3000;
const COMMAND_TIMEOUT = 15_000;

export type ComposerRequest = Readonly<{
  app: ComposerApp;
  effort: string;
  model: string;
  /** The page that the key saw. The command fails on another page. */
  route: string | undefined;
  /** The composer that the key saw. The command fails for another one. */
  composer: number;
}>;

/** A shortcut that the watcher runs in the app window, such as "side-chat". */
export type PanelRequest = Readonly<{ app: ComposerApp; panel: ShortcutId }>;

type PendingCommand = {
  app: ComposerApp;
  reject: (error: Error) => void;
  resolve: (description: string) => void;
  timer: ReturnType<typeof setTimeout>;
};

const EMPTY_PAGE: ComposerPage = {
  composer: undefined,
  index: 0,
  route: undefined,
};

function appFor(value: unknown): AgentApp | undefined {
  return value === "chatgpt" ||
    value === "claude" ||
    value === "codex" ||
    value === "t3code"
    ? value
    : undefined;
}

function pageFrom(value: unknown): ComposerPage {
  if (!value || typeof value !== "object") return EMPTY_PAGE;
  const page = value as Record<string, unknown>;
  return {
    composer: typeof page.composer === "string" ? page.composer : undefined,
    index: Number.isSafeInteger(page.index) ? (page.index as number) : 0,
    route: typeof page.route === "string" ? page.route : undefined,
  };
}

function samePage(left: ComposerPage, right: ComposerPage): boolean {
  return (
    left.composer === right.composer &&
    left.index === right.index &&
    left.route === right.route
  );
}

export class FrontAppWatcher {
  readonly #listeners = new Set<() => void>();
  readonly #pending = new Map<string, PendingCommand>();
  readonly #spawn: Spawn;
  #commandDirectory: string | undefined;
  #child: ReturnType<Spawn> | undefined;
  #lastFront: AgentApp | undefined;
  #restartTimer: ReturnType<typeof setTimeout> | undefined;
  #snapshot: FrontAppSnapshot = {
    accessibility: false,
    app: undefined,
    chatgpt: EMPTY_PAGE,
    claude: EMPTY_PAGE,
    started: false,
    t3code: EMPTY_PAGE,
  };
  #stopped = true;

  constructor(run: Spawn = (command, args) => spawn(command, args)) {
    this.#spawn = run;
  }

  get snapshot(): FrontAppSnapshot {
    return this.#snapshot;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#launch();
  }

  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#restartTimer);
    this.#child?.kill();
    this.#child = undefined;
    this.#rejectPending("The app watcher stopped.");
    if (this.#commandDirectory)
      fs.rmSync(this.#commandDirectory, { force: true, recursive: true });
    this.#commandDirectory = undefined;
  }

  /**
   * Sets the model and thinking level in a T3 Code, ChatGPT, or Claude
   * composer. The watcher process runs the change, because it already knows
   * the window and the model button. Resolves with the final model button
   * label.
   */
  runComposer(request: ComposerRequest): Promise<string> {
    return this.#run(request);
  }

  /** Toggles a panel, such as a side chat, in the window of the app. */
  async runPanel(request: PanelRequest): Promise<void> {
    await this.#run(request);
  }

  #run(request: ComposerRequest | PanelRequest): Promise<string> {
    const directory = this.#commandDirectory;
    const failure = `${APP_NAMES[request.app]} did not apply the change.`;
    if (!this.#child || !directory)
      return Promise.reject(new Error("The app watcher is not running."));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(failure));
      }, COMMAND_TIMEOUT);
      this.#pending.set(id, { app: request.app, reject, resolve, timer });
      try {
        const file = path.join(directory, "command.json");
        const temporary = path.join(directory, `${id}.tmp`);
        fs.writeFileSync(temporary, JSON.stringify({ ...request, id }), {
          mode: 0o600,
        });
        fs.renameSync(temporary, file);
      } catch {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(new Error(failure));
      }
    });
  }

  /** Applies one line from the watcher process. Exposed for tests. */
  apply(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    if (!value || typeof value !== "object") return;
    if ("result" in value) {
      this.#settle((value as { result: unknown }).result);
      return;
    }
    const message = value as {
      ax?: unknown;
      front?: unknown;
      page?: unknown;
      running?: unknown;
    };
    const front = appFor(message.front);
    const running = Array.isArray(message.running)
      ? message.running.map(appFor).filter((app) => app !== undefined)
      : [];
    if (front) this.#lastFront = front;
    const page = pageFrom(message.page);
    const previous = this.#snapshot;
    const next: FrontAppSnapshot = {
      accessibility: message.ax === true,
      app: this.#lastFront ?? (running.length === 1 ? running[0] : undefined),
      chatgpt: front === "chatgpt" ? page : previous.chatgpt,
      claude: front === "claude" ? page : previous.claude,
      started: true,
      t3code: front === "t3code" ? page : previous.t3code,
    };
    this.#snapshot = next;
    if (
      previous.accessibility !== next.accessibility ||
      previous.app !== next.app ||
      previous.started !== next.started ||
      !samePage(previous.chatgpt, next.chatgpt) ||
      !samePage(previous.claude, next.claude) ||
      !samePage(previous.t3code, next.t3code)
    )
      for (const listener of this.#listeners) listener();
  }

  #settle(result: unknown): void {
    if (!result || typeof result !== "object") return;
    const { description, error, id } = result as Record<string, unknown>;
    const pending = typeof id === "string" ? this.#pending.get(id) : undefined;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(id as string);
    if (typeof error === "string") {
      pending.reject(new Error(error));
      return;
    }
    const text = typeof description === "string" ? description : "";
    const page = this.#snapshot[pending.app];
    if (text && text !== page.composer) {
      this.#snapshot = {
        ...this.#snapshot,
        [pending.app]: { ...page, composer: text },
      };
      for (const listener of this.#listeners) listener();
    }
    pending.resolve(text);
  }

  #rejectPending(message?: string): void {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      this.#pending.delete(id);
      pending.reject(
        new Error(
          message ?? `${APP_NAMES[pending.app]} did not apply the change.`,
        ),
      );
    }
  }

  #launch(): void {
    if (this.#stopped) return;
    let child: ReturnType<Spawn>;
    try {
      this.#commandDirectory ??= fs.mkdtempSync(
        path.join(os.tmpdir(), "codex-controls-"),
      );
      child = this.#spawn("/usr/bin/osascript", [
        "-l",
        "JavaScript",
        "-",
        this.#commandDirectory,
      ]);
    } catch {
      this.#schedule(RETRY_DELAY);
      return;
    }
    this.#child = child;
    let buffer = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        this.apply(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
      if (buffer.length > 64 * 1024) buffer = "";
    });
    child.stderr?.resume();
    child.on("error", () => undefined);
    child.on("exit", () => {
      if (this.#child !== child) return;
      this.#child = undefined;
      this.#rejectPending();
      this.#schedule(RETRY_DELAY);
    });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(FRONT_APP_SCRIPT);
    this.#schedule(RESTART_INTERVAL);
  }

  #schedule(milliseconds: number): void {
    clearTimeout(this.#restartTimer);
    if (this.#stopped) return;
    this.#restartTimer = setTimeout(() => {
      if (this.#pending.size > 0 && this.#child) {
        this.#schedule(1000);
        return;
      }
      const child = this.#child;
      this.#child = undefined;
      child?.kill();
      this.#launch();
    }, milliseconds);
    this.#restartTimer.unref?.();
  }
}

export const frontAppWatcher = new FrontAppWatcher();
