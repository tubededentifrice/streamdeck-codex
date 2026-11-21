import { execFile } from "node:child_process";

import type { FrontAppWatcher } from "../apps/front-app-watcher";
import { CodexError } from "../codex/errors";
import { sameEffort, sameModel, type CodexState } from "../domain/settings";
import { COMPOSER_SCRIPT } from "./composer-script";
import { effortFromLabel, parseComposerLabel } from "./labels";

const HOST_PREFIX = "t3code:";
const DRAFT_HOST = `${HOST_PREFIX}draft`;
const ID = /^[A-Za-z0-9][A-Za-z0-9_:.-]{7,159}$/;
const VERIFY_TIMEOUT = 3000;

type Watcher = Pick<FrontAppWatcher, "onChange" | "snapshot">;
export type ComposerRunner = (request: {
  effort: string;
  model: string;
}) => Promise<string>;

/** A sent thread has an environment. An unsent draft has none. */
export type T3Route = Readonly<{
  environmentId: string | undefined;
  threadId: string;
}>;

export function isT3HostId(hostId: string): boolean {
  return hostId.startsWith(HOST_PREFIX);
}

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
  const [first, second] = match
    .slice(1)
    .map((part) => decodeURIComponent(part));
  if (!ID.test(second)) return undefined;
  if (first === "draft") return { environmentId: undefined, threadId: second };
  if (!ID.test(first)) return undefined;
  return { environmentId: first, threadId: second };
}

function hostIdFor(route: T3Route): string {
  return route.environmentId
    ? `${HOST_PREFIX}${route.environmentId}`
    : DRAFT_HOST;
}

function stateFrom(route: T3Route, description: string): CodexState {
  const parsed = parseComposerLabel(description);
  if (!parsed)
    throw new CodexError("task-state-unavailable", "T3 Code shows no model.", {
      app: "t3code",
    });
  return {
    effort:
      parsed.effortLabel === undefined
        ? "default"
        : effortFromLabel(parsed.effortLabel),
    hostId: hostIdFor(route),
    model: parsed.model,
    threadId: route.threadId,
  };
}

function error(
  code: ConstructorParameters<typeof CodexError>[0],
  message: string,
): CodexError {
  return new CodexError(code, message, { app: "t3code" });
}

function runComposer(request: {
  effort: string;
  model: string;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-", JSON.stringify(request)],
      { timeout: 15000 },
      (failure, stdout, stderr) => {
        if (!failure) {
          resolve(stdout.trim());
          return;
        }
        const line = stderr.slice(stderr.lastIndexOf("error:") + 6);
        const message = stderr.includes("error:")
          ? line.split("\n")[0].replace(/ \(-?\d+\)$/, "")
          : undefined;
        reject(
          new Error(message?.trim() || "T3 Code did not apply the change."),
        );
      },
    );
    child.stdin?.end(COMPOSER_SCRIPT);
  });
}

/**
 * Reads and changes the model of the open T3 Code thread or draft through the
 * model button of its composer. The composer shows the next-turn value, also
 * for an unsent draft and for a thread in a linked environment.
 */
export class T3CodeClient {
  readonly #listeners = new Set<() => void>();
  readonly #run: ComposerRunner;
  readonly #watcher: Watcher;
  #routeKey: string | undefined;
  #routeRevision = 0;

  constructor(watcher: Watcher, run: ComposerRunner = runComposer) {
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
    const description = this.#watcher.snapshot.t3Composer;
    if (!description)
      throw error("resolving-task", "T3 Code shows no model button.");
    return stateFrom(route, description);
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
      route.threadId !== expectedThreadId ||
      hostIdFor(route) !== expectedHostId
    )
      throw new Error("The selected task changed before the update.");
    const description = await this.#run({ effort, model });
    const deadline = Date.now() + VERIFY_TIMEOUT;
    let state = description ? stateFrom(route, description) : undefined;
    while (
      !state ||
      !sameModel(state.model, model) ||
      !sameEffort(state.effort, effort)
    ) {
      if (this.#routeKey !== routeKey)
        throw new Error("The selected task changed during the update.");
      if (Date.now() >= deadline)
        throw new Error(
          "T3 Code did not show the requested model and thinking level.",
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
      const current = this.#watcher.snapshot.t3Composer;
      state = current ? stateFrom(route, current) : undefined;
    }
    for (const listener of this.#listeners) listener();
    return state;
  }

  #selectedRoute(): T3Route {
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
    return route;
  }

  #syncRoute(): void {
    const route = parseT3Route(this.#watcher.snapshot.t3Url);
    const key = route ? `${hostIdFor(route)}\0${route.threadId}` : undefined;
    if (key === this.#routeKey) return;
    this.#routeKey = key;
    this.#routeRevision += 1;
  }
}
