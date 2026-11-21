import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CodexError } from "../codex/errors";

export type T3ModelOption = Readonly<{ id: string; value: unknown }>;
export type T3ModelSelection = Readonly<{
  instanceId: string;
  model: string;
  options?: readonly T3ModelOption[];
}>;
export type T3ProviderCapabilities = Readonly<{
  providerInstanceId: string;
  models: readonly Readonly<{
    id: string;
    options?: readonly Readonly<{
      default?: unknown;
      id: string;
      values?: readonly unknown[];
    }>[];
  }>[];
}>;

type Execute = (
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<string>;
type Fetch = typeof fetch;
type Socket = Pick<
  WebSocket,
  "addEventListener" | "close" | "readyState" | "send"
>;
type OpenSocket = (url: string, token: string) => Socket;

type StoredToken = { expiresAt: string; sessionId: string; token: string };
/**
 * `mcp` reads threads and model capabilities through the MCP endpoint. MCP
 * sessions cannot change full-access threads, so `rpc` sends the same
 * `thread.model-selection.set` command as the T3 Code composer.
 */
type TokenKind = "mcp" | "rpc";
type StoredTokens = Partial<Record<TokenKind, StoredToken>>;

const TOKEN_TTL = "30d";
const TOKEN_RENEW_BEFORE = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT = 5000;
const ORCHESTRATION_PROTOCOL = "2";
const ISSUE_RETRY_DELAY = 30_000;

function execute(
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { env, maxBuffer: 1024 * 1024, timeout: 20000 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

function openSocket(url: string, token: string): Socket {
  // Node's WebSocket accepts request headers as a non-standard option.
  const Constructor = WebSocket as unknown as new (
    url: string,
    init: { headers: Record<string, string> },
  ) => WebSocket;
  return new Constructor(url, {
    headers: { authorization: `Bearer ${token}` },
  });
}

function offline(message: string, cause?: unknown): CodexError {
  return new CodexError("offline", message, { app: "t3code", cause });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredToken(value: unknown): value is StoredToken {
  return (
    isRecord(value) &&
    typeof value.token === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.expiresAt === "string"
  );
}

function failureMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ["message", "detail", "reason"])
    if (typeof value[key] === "string") return value[key] as string;
  for (const key of ["error", "defect", "cause", "failure"]) {
    const nested = failureMessage(value[key]);
    if (nested) return nested;
  }
  return undefined;
}

class AuthRejected extends Error {}

/** Access to the local T3 Code server. */
export class T3CodeServer {
  readonly #execute: Execute;
  readonly #fetch: Fetch;
  readonly #home: string;
  readonly #openSocket: OpenSocket;
  readonly #tokenPath: string;
  readonly #issueFailures = new Map<TokenKind, { at: number; error: Error }>();
  readonly #tokenPromises = new Map<TokenKind, Promise<StoredToken>>();
  #mcpSession: { origin: string; sessionId: string | undefined } | undefined;
  #nextId = 1;
  #tokens: StoredTokens | undefined;

  constructor(
    options: {
      execute?: Execute;
      fetch?: Fetch;
      home?: string;
      openSocket?: OpenSocket;
      tokenPath?: string;
    } = {},
  ) {
    this.#execute = options.execute ?? execute;
    this.#fetch = options.fetch ?? fetch;
    this.#openSocket = options.openSocket ?? openSocket;
    this.#home =
      options.home ??
      (process.env.T3CODE_HOME || path.join(os.homedir(), ".t3"));
    this.#tokenPath =
      options.tokenPath ??
      path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "com.courcelle.codex-controls",
        "t3code-sessions.json",
      );
  }

  async environmentId(): Promise<string> {
    try {
      return (
        await fs.readFile(
          path.join(this.#home, "userdata", "environment-id"),
          "utf8",
        )
      ).trim();
    } catch (error) {
      throw offline("T3 Code has no local environment.", error);
    }
  }

  async readSelection(threadId: string): Promise<T3ModelSelection> {
    const result = await this.#callTool("t3_thread_configure", { threadId });
    const selection = isRecord(result) ? result.modelSelection : undefined;
    if (
      !isRecord(selection) ||
      typeof selection.instanceId !== "string" ||
      typeof selection.model !== "string"
    )
      throw new CodexError(
        "task-state-unavailable",
        "T3 Code did not return the thread model.",
        { app: "t3code" },
      );
    return {
      instanceId: selection.instanceId,
      model: selection.model,
      options: Array.isArray(selection.options)
        ? selection.options.filter(
            (option): option is T3ModelOption =>
              isRecord(option) && typeof option.id === "string",
          )
        : [],
    };
  }

  async capabilities(): Promise<T3ProviderCapabilities[]> {
    const result = await this.#callTool("orchestrator_capabilities", {});
    const providers = isRecord(result) ? result.providers : undefined;
    if (!Array.isArray(providers)) return [];
    return providers.filter(
      (provider): provider is T3ProviderCapabilities =>
        isRecord(provider) &&
        typeof provider.providerInstanceId === "string" &&
        Array.isArray(provider.models),
    );
  }

  async writeSelection(
    threadId: string,
    modelSelection: T3ModelSelection,
  ): Promise<void> {
    const command = {
      commandId: crypto.randomUUID(),
      modelSelection,
      threadId,
      type: "thread.model-selection.set",
    };
    for (let attempt = 0; ; attempt += 1) {
      const origin = await this.#origin();
      const token = await this.#validToken("rpc");
      try {
        await this.#dispatch(origin, token.token, command);
        return;
      } catch (error) {
        if (!(error instanceof AuthRejected) || attempt > 0) throw error;
        await this.#validToken("rpc", true);
      }
    }
  }

  #dispatch(
    origin: string,
    token: string,
    command: Record<string, unknown>,
  ): Promise<void> {
    const url = new URL("/ws", origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("orchestrationProtocol", ORCHESTRATION_PROTOCOL);
    return new Promise((resolve, reject) => {
      let settled = false;
      let opened = false;
      let socket: Socket;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // Already closed.
        }
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(
        () => finish(offline("T3 Code did not answer the update.")),
        REQUEST_TIMEOUT,
      );
      try {
        socket = this.#openSocket(url.href, token);
      } catch (error) {
        clearTimeout(timer);
        reject(offline("T3 Code is not reachable.", error));
        return;
      }
      socket.addEventListener("open", () => {
        opened = true;
        socket.send(
          JSON.stringify({
            _tag: "Request",
            headers: [],
            id: "1",
            payload: command,
            tag: "orchestration.dispatchCommand",
          }),
        );
      });
      socket.addEventListener("message", (event) => {
        let message: unknown;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!isRecord(message)) return;
        if (message._tag === "Ping") {
          socket.send(JSON.stringify({ _tag: "Pong" }));
          return;
        }
        if (message._tag !== "Exit" || message.requestId !== "1") return;
        const exit = isRecord(message.exit) ? message.exit : {};
        if (exit._tag === "Success") finish();
        else
          finish(
            new Error(
              failureMessage(exit.cause) ?? "T3 Code rejected the update.",
            ),
          );
      });
      socket.addEventListener("error", () => {
        finish(
          opened
            ? offline("T3 Code closed the update connection.")
            : new AuthRejected("T3 Code refused the update connection."),
        );
      });
      socket.addEventListener("close", () => {
        finish(
          opened
            ? offline("T3 Code closed the update connection.")
            : new AuthRejected("T3 Code refused the update connection."),
        );
      });
    });
  }

  async #origin(): Promise<string> {
    let runtime: unknown;
    try {
      runtime = JSON.parse(
        await fs.readFile(
          path.join(this.#home, "userdata", "server-runtime.json"),
          "utf8",
        ),
      );
    } catch (error) {
      throw offline("T3 Code is not running.", error);
    }
    const origin = isRecord(runtime) ? runtime.origin : undefined;
    if (typeof origin !== "string") throw offline("T3 Code is not running.");
    const url = new URL(origin);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      throw offline("T3 Code does not listen on this Mac.");
    return url.origin;
  }

  async #callTool(name: string, args: Record<string, unknown>) {
    const result = await this.#rpc("tools/call", { arguments: args, name });
    if (!isRecord(result)) throw offline("T3 Code returned an invalid reply.");
    if (result.isError === true) {
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content.find(
        (part): part is { text: string } =>
          isRecord(part) && typeof part.text === "string",
      )?.text;
      let message = text;
      try {
        const parsed: unknown = text ? JSON.parse(text) : undefined;
        message = failureMessage(parsed) ?? message;
      } catch {
        // Plain-text failure.
      }
      throw new Error(message || `T3 Code rejected ${name}.`);
    }
    return result.structuredContent;
  }

  async #rpc(
    method: string,
    params: Record<string, unknown>,
    retry = true,
  ): Promise<unknown> {
    const origin = await this.#origin();
    const token = await this.#validToken("mcp");
    if (this.#mcpSession?.origin !== origin) {
      this.#mcpSession = undefined;
      const response = await this.#post(origin, token.token, undefined, {
        id: this.#nextId++,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "codex-controls-streamdeck", version: "1" },
          protocolVersion: "2025-06-18",
        },
      });
      await response.body?.cancel();
      if (response.status === 401 && retry) {
        await this.#validToken("mcp", true);
        return this.#rpc(method, params, false);
      }
      if (!response.ok) throw offline("T3 Code refused the connection.");
      const sessionId = response.headers.get("mcp-session-id") ?? undefined;
      this.#mcpSession = { origin, sessionId };
      const initialized = await this.#post(origin, token.token, sessionId, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });
      await initialized.body?.cancel();
    }
    const session = this.#mcpSession;
    const response = await this.#post(origin, token.token, session.sessionId, {
      id: this.#nextId++,
      jsonrpc: "2.0",
      method,
      params,
    });
    if ((response.status === 401 || response.status === 404) && retry) {
      await response.body?.cancel();
      this.#mcpSession = undefined;
      if (response.status === 401) await this.#validToken("mcp", true);
      return this.#rpc(method, params, false);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw offline(`T3 Code returned HTTP ${response.status}.`);
    }
    const body = (await response.json()) as unknown;
    if (!isRecord(body)) throw offline("T3 Code returned an invalid reply.");
    if (isRecord(body.error))
      throw new Error(
        failureMessage(body.error) ?? "T3 Code rejected the request.",
      );
    return body.result;
  }

  async #post(
    origin: string,
    token: string,
    sessionId: string | undefined,
    body: unknown,
  ): Promise<Response> {
    try {
      return await this.#fetch(new URL("/mcp", origin), {
        body: JSON.stringify(body),
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        },
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
    } catch (error) {
      this.#mcpSession = undefined;
      throw offline("T3 Code is not reachable.", error);
    }
  }

  async #validToken(kind: TokenKind, renew = false): Promise<StoredToken> {
    const current = (await this.#loadTokens())[kind];
    if (
      !renew &&
      current &&
      Date.parse(current.expiresAt) - Date.now() > TOKEN_RENEW_BEFORE
    )
      return current;
    let pending = this.#tokenPromises.get(kind);
    if (!pending) {
      const failure = this.#issueFailures.get(kind);
      if (failure && Date.now() - failure.at < ISSUE_RETRY_DELAY)
        throw failure.error;
      pending = this.#issueToken(kind)
        .then(
          (token) => {
            this.#issueFailures.delete(kind);
            return token;
          },
          (error: unknown) => {
            this.#issueFailures.set(kind, {
              at: Date.now(),
              error:
                error instanceof Error
                  ? error
                  : offline("The T3 Code CLI could not issue a session."),
            });
            throw error;
          },
        )
        .finally(() => {
          this.#tokenPromises.delete(kind);
        });
      this.#tokenPromises.set(kind, pending);
    }
    return pending;
  }

  async #loadTokens(): Promise<StoredTokens> {
    if (this.#tokens) return this.#tokens;
    let tokens: StoredTokens = {};
    try {
      const value: unknown = JSON.parse(
        await fs.readFile(this.#tokenPath, "utf8"),
      );
      if (isRecord(value))
        tokens = {
          ...(isStoredToken(value.mcp) ? { mcp: value.mcp } : {}),
          ...(isStoredToken(value.rpc) ? { rpc: value.rpc } : {}),
        };
    } catch {
      // No stored sessions.
    }
    this.#tokens = tokens;
    return tokens;
  }

  async #saveTokens(tokens: StoredTokens): Promise<void> {
    this.#tokens = tokens;
    await fs.mkdir(path.dirname(this.#tokenPath), {
      mode: 0o700,
      recursive: true,
    });
    const temporary = `${this.#tokenPath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(tokens), { mode: 0o600 });
    await fs.rename(temporary, this.#tokenPath);
  }

  #cli(args: readonly string[]): Promise<string> {
    return this.#execute(path.join(this.#home, "bin", "t3"), args, {
      ...process.env,
      T3CODE_HOME: this.#home,
    });
  }

  async #issueToken(kind: TokenKind): Promise<StoredToken> {
    const previous = (await this.#loadTokens())[kind];
    let output: string;
    try {
      output = await this.#cli([
        "auth",
        "session",
        "issue",
        ...(kind === "mcp" ? ["--subject", "mcp-client"] : []),
        "--scope",
        "orchestration:read",
        "--scope",
        "orchestration:operate",
        "--ttl",
        TOKEN_TTL,
        "--label",
        "Stream Deck",
        "--json",
      ]);
    } catch (error) {
      throw offline("The T3 Code CLI could not issue a session.", error);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch (error) {
      throw offline("The T3 Code CLI returned an invalid session.", error);
    }
    if (!isStoredToken(parsed))
      throw offline("The T3 Code CLI returned an invalid session.");
    const token: StoredToken = {
      expiresAt: parsed.expiresAt,
      sessionId: parsed.sessionId,
      token: parsed.token,
    };
    await this.#saveTokens({ ...(await this.#loadTokens()), [kind]: token });
    if (kind === "mcp") this.#mcpSession = undefined;
    if (previous && previous.sessionId !== token.sessionId)
      void this.#cli(["auth", "session", "revoke", previous.sessionId]).catch(
        () => undefined,
      );
    return token;
  }
}
