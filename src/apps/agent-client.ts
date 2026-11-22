import { isChatGPTHostId, type ChatGPTClient } from "../chatgpt/client";
import type { CodexDesktopClient } from "../codex/desktop-client";
import type { CodexState } from "../domain/settings";
import { isT3HostId, type T3CodeClient } from "../t3code/client";
import type { AgentApp, FrontAppWatcher } from "./front-app-watcher";

type CodexClient = Pick<
  CodexDesktopClient,
  "onChange" | "readState" | "restoreRoute" | "routeRevision" | "update"
>;
type ComposerClient = Pick<
  ChatGPTClient | T3CodeClient,
  "onChange" | "readState" | "routeRevision" | "update"
>;
type Watcher = Pick<FrontAppWatcher, "onChange" | "snapshot">;

/** The longest wait for the first app watcher report after start. */
const FIRST_REPORT_TIMEOUT = 2000;

/**
 * Routes key reads and updates to the last frontmost supported app. Codex is
 * the default until ChatGPT or T3 Code comes to the front.
 */
export class AgentClient {
  readonly #chatgpt: ComposerClient;
  readonly #codex: CodexClient;
  readonly #t3: ComposerClient;
  readonly #firstReportTimeout: number;
  readonly #watcher: Watcher;
  #app: AgentApp;
  #firstReport: Promise<void> | undefined;
  #switches = 0;

  constructor(
    codex: CodexClient,
    t3: ComposerClient,
    chatgpt: ComposerClient,
    watcher: Watcher,
    firstReportTimeout = FIRST_REPORT_TIMEOUT,
  ) {
    this.#chatgpt = chatgpt;
    this.#firstReportTimeout = firstReportTimeout;
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
    return (
      this.#codex.routeRevision +
      this.#t3.routeRevision +
      this.#chatgpt.routeRevision +
      this.#switches
    );
  }

  restoreRoute(value: unknown): void {
    this.#codex.restoreRoute(value);
  }

  onChange(listener: () => void): () => void {
    const removers = [
      this.#codex.onChange(listener),
      this.#t3.onChange(listener),
      this.#chatgpt.onChange(listener),
      this.#watcher.onChange(listener),
    ];
    return () => {
      for (const remove of removers) remove();
    };
  }

  async readState(): Promise<CodexState> {
    await this.#waitForFirstReport();
    if (this.#app === "t3code") return this.#t3.readState();
    if (this.#app === "chatgpt") return this.#chatgpt.readState();
    return this.#codex.readState();
  }

  /**
   * The frontmost app is unknown until the watcher reports once. Without this
   * wait, a start with ChatGPT or T3 Code in front reads Codex desktop first
   * and shows a false offline error. After the timeout, Codex is the default.
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
    const client = isT3HostId(expectedHostId)
      ? this.#t3
      : isChatGPTHostId(expectedHostId)
        ? this.#chatgpt
        : this.#codex;
    return client.update(model, effort, expectedThreadId, expectedHostId);
  }
}
