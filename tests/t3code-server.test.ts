import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { T3CodeServer } from "../src/t3code/server";

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "t3code-test-"));
  await fs.mkdir(path.join(home, "userdata"));
  await fs.writeFile(
    path.join(home, "userdata", "server-runtime.json"),
    JSON.stringify({ origin: "http://127.0.0.1:3773" }),
  );
  await fs.writeFile(
    path.join(home, "userdata", "environment-id"),
    "env-0001\n",
  );
});

afterEach(async () => {
  await fs.rm(home, { force: true, recursive: true });
});

function session(id: string) {
  return JSON.stringify({
    expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    sessionId: id,
    token: `token-${id}`,
  });
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...init.headers },
    status: init.status ?? 200,
  });
}

function mcp(result: unknown) {
  return vi.fn(async (_url: URL | Request | string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string };
    if (body.method === "initialize")
      return json({ result: {} }, { headers: { "mcp-session-id": "mcp-1" } });
    if (body.method === "notifications/initialized")
      return new Response(null, { status: 202 });
    return json({ result: { structuredContent: result } });
  });
}

class FakeSocket {
  readonly listeners = new Map<
    string,
    ((event: { data?: unknown }) => void)[]
  >();
  readonly sent: string[] = [];
  readyState = 0;
  constructor(readonly reply: (request: { id: string }) => unknown) {
    queueMicrotask(() => this.emit("open", {}));
  }
  addEventListener(
    name: string,
    listener: (event: { data?: unknown }) => void,
  ) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  close() {
    this.readyState = 3;
  }
  emit(name: string, event: { data?: unknown }) {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
  send(data: string) {
    this.sent.push(data);
    const request = JSON.parse(data) as { id: string };
    queueMicrotask(() =>
      this.emit("message", { data: JSON.stringify(this.reply(request)) }),
    );
  }
}

describe("T3 Code server", () => {
  it("issues an MCP session once and reads the thread model", async () => {
    const execute = vi.fn(async () => session("mcp-session"));
    const fetch = mcp({
      modelSelection: {
        instanceId: "codex",
        model: "gpt-6.2-sol",
        options: [{ id: "reasoningEffort", value: "high" }],
      },
    });
    const tokenPath = path.join(home, "sessions.json");
    const server = new T3CodeServer({ execute, fetch, home, tokenPath });

    await expect(server.readSelection("thread-0001")).resolves.toEqual({
      instanceId: "codex",
      model: "gpt-6.2-sol",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
    await server.readSelection("thread-0001");

    expect(execute).toHaveBeenCalledOnce();
    const [file, args] = execute.mock.calls[0] as unknown as [string, string[]];
    expect(file).toBe(path.join(home, "bin", "t3"));
    expect(args).toEqual(
      expect.arrayContaining(["--subject", "mcp-client", "--json"]),
    );
    expect((await fs.stat(tokenPath)).mode & 0o777).toBe(0o600);
    const call = fetch.mock.calls.at(-1)!;
    expect(String(call[0])).toBe("http://127.0.0.1:3773/mcp");
    expect(call[1]?.headers).toMatchObject({
      authorization: "Bearer token-mcp-session",
      "mcp-session-id": "mcp-1",
    });
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({
      method: "tools/call",
      params: {
        arguments: { threadId: "thread-0001" },
        name: "t3_thread_configure",
      },
    });
  });

  it("issues a new session after T3 Code rejects the stored one", async () => {
    const tokenPath = path.join(home, "sessions.json");
    await fs.writeFile(
      tokenPath,
      JSON.stringify({ mcp: JSON.parse(session("old")) }),
    );
    const execute = vi.fn(async () => session("new"));
    const inner = mcp({ modelSelection: { instanceId: "codex", model: "m" } });
    const fetch = vi.fn(
      async (url: URL | Request | string, init?: RequestInit) =>
        (init?.headers as Record<string, string>).authorization ===
        "Bearer token-old"
          ? new Response(null, { status: 401 })
          : inner(url, init),
    );
    const server = new T3CodeServer({ execute, fetch, home, tokenPath });

    await expect(server.readSelection("thread-0001")).resolves.toMatchObject({
      model: "m",
    });
    const calls = execute.mock.calls as unknown as [string, string[]][];
    expect(calls.map(([, args]) => args.slice(0, 3))).toEqual([
      ["auth", "session", "issue"],
      ["auth", "session", "revoke"],
    ]);
    expect(calls[1][1][3]).toBe("old");
  });

  it("waits before it runs the T3 Code CLI again after a failure", async () => {
    const execute = vi.fn(async () => {
      throw new Error("ServerOwnsDatabaseError");
    });
    const server = new T3CodeServer({
      execute,
      fetch: vi.fn(),
      home,
      tokenPath: path.join(home, "sessions.json"),
    });

    for (let attempt = 0; attempt < 3; attempt += 1)
      await expect(server.readSelection("thread-0001")).rejects.toMatchObject({
        code: "offline",
      });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("reports a stopped T3 Code server", async () => {
    await fs.rm(path.join(home, "userdata", "server-runtime.json"));
    const server = new T3CodeServer({
      execute: vi.fn(),
      fetch: vi.fn(),
      home,
      tokenPath: path.join(home, "sessions.json"),
    });

    await expect(server.readSelection("thread-0001")).rejects.toMatchObject({
      app: "t3code",
      code: "offline",
    });
  });

  it("sends the model selection command over the T3 Code socket", async () => {
    const sockets: FakeSocket[] = [];
    const urls: string[] = [];
    const server = new T3CodeServer({
      execute: vi.fn(async () => session("rpc-session")),
      fetch: vi.fn(),
      home,
      openSocket: (url, token) => {
        urls.push(`${url} ${token}`);
        const socket = new FakeSocket((request) => ({
          _tag: "Exit",
          exit: { _tag: "Success", value: { sequence: 1 } },
          requestId: request.id,
        }));
        sockets.push(socket);
        return socket as never;
      },
      tokenPath: path.join(home, "sessions.json"),
    });

    await server.writeSelection("thread-0001", {
      instanceId: "codex",
      model: "gpt-6.2-sol",
    });

    expect(urls).toEqual([
      "ws://127.0.0.1:3773/ws?orchestrationProtocol=2 token-rpc-session",
    ]);
    expect(JSON.parse(sockets[0].sent[0])).toMatchObject({
      _tag: "Request",
      payload: {
        modelSelection: { instanceId: "codex", model: "gpt-6.2-sol" },
        threadId: "thread-0001",
        type: "thread.model-selection.set",
      },
      tag: "orchestration.dispatchCommand",
    });
  });

  it("reports a rejected command", async () => {
    const server = new T3CodeServer({
      execute: vi.fn(async () => session("rpc-session")),
      fetch: vi.fn(),
      home,
      openSocket: () =>
        new FakeSocket((request) => ({
          _tag: "Exit",
          exit: {
            _tag: "Failure",
            cause: {
              _tag: "Fail",
              error: { message: "Model is unavailable." },
            },
          },
          requestId: request.id,
        })) as never,
      tokenPath: path.join(home, "sessions.json"),
    });

    await expect(
      server.writeSelection("thread-0001", { instanceId: "codex", model: "x" }),
    ).rejects.toThrow("Model is unavailable.");
  });
});
