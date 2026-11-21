import type { CodexDesktopClient } from "../codex/desktop-client";
import type { CodexState } from "../domain/settings";
import { isT3HostId, type T3CodeClient } from "../t3code/client";
import type { AgentApp, FrontAppWatcher } from "./front-app-watcher";

type CodexClient = Pick<
  CodexDesktopClient,
  "onChange" | "readState" | "restoreRoute" | "routeRevision" | "update"
>;
type T3Client = Pick<
  T3CodeClient,
  "onChange" | "readState" | "routeRevision" | "update"
>;
type Watcher = Pick<FrontAppWatcher, "onChange" | "snapshot">;

/**
 * Routes key reads and updates to the last frontmost supported app. Codex is
 * the default until T3 Code comes to the front.
 */
export class AgentClient {
  readonly #codex: CodexClient;
  readonly #t3: T3Client;
  readonly #watcher: Watcher;
  #app: AgentApp;
  #switches = 0;

  constructor(codex: CodexClient, t3: T3Client, watcher: Watcher) {
    this.#codex = codex;
    this.#t3 = t3;
    this.#watcher = watcher;
    this.#app = watcher.snapshot.app ?? "codex";
    watcher.onChange(() => {
      const app = watcher.snapshot.app ?? "codex";
      if (app === this.#app) return;
      this.#app = app;
      this.#switches += 1;
    });
  }

  get app(): AgentApp {
    return this.#app;
  }

  get routeRevision(): number {
    return this.#codex.routeRevision + this.#t3.routeRevision + this.#switches;
  }

  restoreRoute(value: unknown): void {
    this.#codex.restoreRoute(value);
  }

  onChange(listener: () => void): () => void {
    const removers = [
      this.#codex.onChange(listener),
      this.#t3.onChange(listener),
      this.#watcher.onChange(listener),
    ];
    return () => {
      for (const remove of removers) remove();
    };
  }

  readState(): Promise<CodexState> {
    return this.#app === "t3code"
      ? this.#t3.readState()
      : this.#codex.readState();
  }

  update(
    model: string,
    effort: string,
    expectedThreadId: string,
    expectedHostId: string,
  ): Promise<CodexState> {
    return isT3HostId(expectedHostId)
      ? this.#t3.update(model, effort, expectedThreadId, expectedHostId)
      : this.#codex.update(model, effort, expectedThreadId, expectedHostId);
  }
}
