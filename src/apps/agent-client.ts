import { isChatGPTHostId, type ChatGPTClient } from "../chatgpt/client";
import { isClaudeHostId, type ClaudeClient } from "../claude/client";
import type { CodexDesktopClient } from "../codex/desktop-client";
import type { CodexState } from "../domain/settings";
import { isT3HostId, type T3CodeClient } from "../t3code/client";
import type { AgentApp, FrontAppWatcher } from "./front-app-watcher";

type CodexClient = Pick<
  CodexDesktopClient,
  "onChange" | "readState" | "restoreRoute" | "routeRevision" | "update"
>;
type ComposerClient = Pick<
  ChatGPTClient | ClaudeClient | T3CodeClient,
  "onChange" | "readState" | "routeRevision" | "update"
>;
type Watcher = Pick<FrontAppWatcher, "onChange" | "snapshot">;

/** The longest wait for the first app watcher report after start. */
const FIRST_REPORT_TIMEOUT = 2000;

export type AgentClients = Readonly<
  { codex: CodexClient } & Record<Exclude<AgentApp, "codex">, ComposerClient>
>;

/** The app that owns a task host ID. */
export function appForHostId(hostId: string): AgentApp {
  if (isT3HostId(hostId)) return "t3code";
  if (isChatGPTHostId(hostId)) return "chatgpt";
  if (isClaudeHostId(hostId)) return "claude";
  return "codex";
}

/**
 * Routes key reads and updates to the last frontmost supported app. Codex is
 * the default until ChatGPT, Claude, or T3 Code comes to the front.
 */
export class AgentClient {
  readonly #clients: AgentClients;
  readonly #firstReportTimeout: number;
  readonly #watcher: Watcher;
  #app: AgentApp;
  #firstReport: Promise<void> | undefined;
  #switches = 0;

  constructor(
    clients: AgentClients,
    watcher: Watcher,
    firstReportTimeout = FIRST_REPORT_TIMEOUT,
  ) {
    this.#clients = clients;
    this.#firstReportTimeout = firstReportTimeout;
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
    let revision = this.#switches;
    for (const client of Object.values(this.#clients))
      revision += client.routeRevision;
    return revision;
  }

  restoreRoute(value: unknown): void {
    this.#clients.codex.restoreRoute(value);
  }

  onChange(listener: () => void): () => void {
    const removers = [
      ...Object.values(this.#clients).map((client) =>
        client.onChange(listener),
      ),
      this.#watcher.onChange(listener),
    ];
    return () => {
      for (const remove of removers) remove();
    };
  }

  async readState(): Promise<CodexState> {
    await this.#waitForFirstReport();
    return this.#clients[this.#app].readState();
  }

  /**
   * The frontmost app is unknown until the watcher reports once. Without this
   * wait, a start with ChatGPT, Claude, or T3 Code in front reads Codex
   * desktop first and shows a false offline error. After the timeout, Codex is
   * the default.
   */
  #waitForFirstReport(): Promise<void> {
    if (this.#watcher.snapshot.started) return Promise.resolve();
    this.#firstReport ??= new Promise((resolve) => {
      let remove = (): void => undefined;
      const done = () => {
        clearTimeout(timer);
        remove();
        resolve();
      };
      const timer = setTimeout(done, this.#firstReportTimeout);
      remove = this.#watcher.onChange(() => {
        if (this.#watcher.snapshot.started) done();
      });
    });
    return this.#firstReport;
  }

  update(
    model: string,
    effort: string,
    expectedThreadId: string,
    expectedHostId: string,
  ): Promise<CodexState> {
    return this.#clients[appForHostId(expectedHostId)].update(
      model,
      effort,
      expectedThreadId,
      expectedHostId,
    );
  }
}
