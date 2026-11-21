import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { FRONT_APP_SCRIPT } from "./front-app-script";

export const CODEX_BUNDLE_ID = "com.openai.codex";
export const T3CODE_BUNDLE_ID = "com.t3tools.t3code";

export type AgentApp = "codex" | "t3code";

export type FrontAppSnapshot = Readonly<{
  /** The last frontmost supported app. Stream Deck does not take focus. */
  app: AgentApp | undefined;
  accessibility: boolean;
  started: boolean;
  /** The description of the T3 Code model button, such as "GPT-6.2-Sol, High · Standard". */
  t3Composer: string | undefined;
  t3Url: string | undefined;
}>;

type Spawn = (
  command: string,
  args: readonly string[],
) => Pick<ChildProcess, "kill" | "on" | "stderr" | "stdin" | "stdout">;

const RESTART_INTERVAL = 30 * 60 * 1000;
const RETRY_DELAY = 3000;
const COMMAND_TIMEOUT = 15_000;

export type ComposerRequest = Readonly<{
  effort: string;
  model: string;
  /** The T3 Code page that the key saw. The command fails on another page. */
  url: string | undefined;
}>;

type PendingCommand = {
  reject: (error: Error) => void;
  resolve: (description: string) => void;
  timer: ReturnType<typeof setTimeout>;
};

function appFor(bundleId: unknown): AgentApp | undefined {
  if (bundleId === CODEX_BUNDLE_ID) return "codex";
  if (bundleId === T3CODE_BUNDLE_ID) return "t3code";
  return undefined;
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
    started: false,
    t3Composer: undefined,
    t3Url: undefined,
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
    this.#rejectPending("The T3 Code watcher stopped.");
    if (this.#commandDirectory)
      fs.rmSync(this.#commandDirectory, { force: true, recursive: true });
    this.#commandDirectory = undefined;
  }

  /**
   * Sets the model and thinking level in the T3 Code composer. The watcher
   * process runs the change, because it already knows the window and the model
   * button. Resolves with the final model button description.
   */
  runComposer(request: ComposerRequest): Promise<string> {
    const directory = this.#commandDirectory;
    if (!this.#child || !directory)
      return Promise.reject(new Error("The T3 Code watcher is not running."));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error("T3 Code did not apply the change."));
      }, COMMAND_TIMEOUT);
      this.#pending.set(id, { reject, resolve, timer });
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
        reject(new Error("T3 Code did not apply the change."));
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
      composer?: unknown;
      front?: unknown;
      running?: unknown;
      t3?: unknown;
    };
    const front = appFor(message.front);
    const running = Array.isArray(message.running)
      ? message.running.map(appFor).filter((app) => app !== undefined)
      : [];
    if (front) this.#lastFront = front;
    const next: FrontAppSnapshot = {
      accessibility: message.ax === true,
      app: this.#lastFront ?? (running.length === 1 ? running[0] : undefined),
      started: true,
      t3Composer:
        front === "t3code"
          ? typeof message.composer === "string"
            ? message.composer
            : undefined
          : this.#snapshot.t3Composer,
      t3Url:
        front === "t3code"
          ? typeof message.t3 === "string"
            ? message.t3
            : undefined
          : this.#snapshot.t3Url,
    };
    const previous = this.#snapshot;
    this.#snapshot = next;
    if (
      previous.accessibility !== next.accessibility ||
      previous.app !== next.app ||
      previous.started !== next.started ||
      previous.t3Composer !== next.t3Composer ||
      previous.t3Url !== next.t3Url
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
    if (text && text !== this.#snapshot.t3Composer) {
      this.#snapshot = { ...this.#snapshot, t3Composer: text };
      for (const listener of this.#listeners) listener();
    }
    pending.resolve(text);
  }

  #rejectPending(message: string): void {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      this.#pending.delete(id);
      pending.reject(new Error(message));
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
      this.#rejectPending("T3 Code did not apply the change.");
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
