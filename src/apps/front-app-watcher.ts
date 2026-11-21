import { spawn, type ChildProcess } from "node:child_process";

import { FRONT_APP_SCRIPT } from "./front-app-script";

export const CODEX_BUNDLE_ID = "com.openai.codex";
export const T3CODE_BUNDLE_ID = "com.t3tools.t3code";

export type AgentApp = "codex" | "t3code";

export type FrontAppSnapshot = Readonly<{
  /** The last frontmost supported app. Stream Deck does not take focus. */
  app: AgentApp | undefined;
  accessibility: boolean;
  started: boolean;
  t3Url: string | undefined;
}>;

type Spawn = (
  command: string,
  args: readonly string[],
) => Pick<ChildProcess, "kill" | "on" | "stderr" | "stdin" | "stdout">;

const RESTART_INTERVAL = 30 * 60 * 1000;
const RETRY_DELAY = 3000;

function appFor(bundleId: unknown): AgentApp | undefined {
  if (bundleId === CODEX_BUNDLE_ID) return "codex";
  if (bundleId === T3CODE_BUNDLE_ID) return "t3code";
  return undefined;
}

export class FrontAppWatcher {
  readonly #listeners = new Set<() => void>();
  readonly #spawn: Spawn;
  #child: ReturnType<Spawn> | undefined;
  #lastFront: AgentApp | undefined;
  #restartTimer: ReturnType<typeof setTimeout> | undefined;
  #snapshot: FrontAppSnapshot = {
    accessibility: false,
    app: undefined,
    started: false,
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
    const message = value as {
      ax?: unknown;
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
      previous.t3Url !== next.t3Url
    )
      for (const listener of this.#listeners) listener();
  }

  #launch(): void {
    if (this.#stopped) return;
    let child: ReturnType<Spawn>;
    try {
      child = this.#spawn("/usr/bin/osascript", ["-l", "JavaScript", "-"]);
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
      const child = this.#child;
      this.#child = undefined;
      child?.kill();
      this.#launch();
    }, milliseconds);
    this.#restartTimer.unref?.();
  }
}

export const frontAppWatcher = new FrontAppWatcher();
