import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { FrontAppWatcher } from "../src/apps/front-app-watcher";

const URL = "t3code://app/#/412c5129-d175-4431-b1e9-1cf9dcfe2ab7/thread-0001";
const EMPTY = { composer: undefined, index: 0, route: undefined };

function line(value: unknown): string {
  return JSON.stringify(value);
}

describe("front app watcher", () => {
  it("keeps the last frontmost supported app", () => {
    const watcher = new FrontAppWatcher();
    const listener = vi.fn();
    watcher.onChange(listener);

    watcher.apply(
      line({
        ax: true,
        front: "t3code",
        page: { composer: "GPT-6.2-Sol, High", index: 0, route: URL },
        running: ["codex", "t3code"],
      }),
    );
    expect(watcher.snapshot).toEqual({
      accessibility: true,
      app: "t3code",
      chatgpt: EMPTY,
      claude: EMPTY,
      started: true,
      t3code: { composer: "GPT-6.2-Sol, High", index: 0, route: URL },
    });

    watcher.apply(line({ ax: true, front: null, page: null }));
    expect(watcher.snapshot.app).toBe("t3code");
    expect(watcher.snapshot.t3code.route).toBe(URL);

    watcher.apply(line({ ax: true, front: "codex", page: null }));
    expect(watcher.snapshot.app).toBe("codex");
    expect(watcher.snapshot.t3code.route).toBe(URL);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps the ChatGPT page apart from the T3 Code page", () => {
    const watcher = new FrontAppWatcher();
    watcher.apply(
      line({
        ax: true,
        front: "chatgpt",
        page: { composer: "GPT-6.2 Sol High", index: 1, route: "Upgrade" },
      }),
    );
    watcher.apply(
      line({
        ax: true,
        front: "t3code",
        page: { composer: "A, Low", index: 0, route: URL },
      }),
    );

    expect(watcher.snapshot).toMatchObject({
      app: "t3code",
      chatgpt: { composer: "GPT-6.2 Sol High", index: 1, route: "Upgrade" },
      t3code: { composer: "A, Low", index: 0, route: URL },
    });
  });

  it("keeps the Claude page apart from the other pages", () => {
    const watcher = new FrontAppWatcher();
    const listener = vi.fn();
    watcher.onChange(listener);
    watcher.apply(
      line({
        ax: true,
        front: "claude",
        page: {
          composer: "Opus 5.5, High",
          index: 0,
          route: "https://claude.ai/epitaxy",
        },
      }),
    );
    watcher.apply(line({ ax: true, front: "codex", page: null }));

    expect(watcher.snapshot).toMatchObject({
      app: "codex",
      chatgpt: EMPTY,
      claude: {
        composer: "Opus 5.5, High",
        index: 0,
        route: "https://claude.ai/epitaxy",
      },
      t3code: EMPTY,
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("uses the only running app before one comes to the front", () => {
    const watcher = new FrontAppWatcher();

    watcher.apply(line({ ax: false, front: null, running: ["t3code"] }));
    expect(watcher.snapshot.app).toBe("t3code");
    watcher.apply(line({ ax: false, front: null, running: ["chatgpt"] }));
    expect(watcher.snapshot.app).toBe("chatgpt");
    watcher.apply(line({ ax: false, front: null, running: ["claude"] }));
    expect(watcher.snapshot.app).toBe("claude");

    const both = new FrontAppWatcher();
    both.apply(line({ ax: false, front: null, running: ["codex", "t3code"] }));
    expect(both.snapshot.app).toBeUndefined();
  });

  it("follows the composer that has the focus", () => {
    const watcher = new FrontAppWatcher();
    const listener = vi.fn();
    watcher.onChange(listener);
    watcher.apply(
      line({
        ax: true,
        front: "t3code",
        page: { composer: "A, High", index: 0, route: URL },
      }),
    );
    watcher.apply(
      line({
        ax: true,
        front: "t3code",
        page: { composer: "B, Low", index: 1, route: URL },
      }),
    );

    expect(watcher.snapshot.t3code).toEqual({
      composer: "B, Low",
      index: 1,
      route: URL,
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("clears the page when the frontmost app shows no page", () => {
    const watcher = new FrontAppWatcher();
    watcher.apply(
      line({ ax: true, front: "t3code", page: { index: 0, route: URL } }),
    );
    watcher.apply(line({ ax: true, front: "t3code", page: { route: null } }));

    expect(watcher.snapshot.t3code).toEqual(EMPTY);
  });

  it("ignores invalid lines", () => {
    const watcher = new FrontAppWatcher();
    watcher.apply("not json");
    watcher.apply("42");

    expect(watcher.snapshot.started).toBe(false);
  });

  it("reads split lines from the watcher process and restarts it", () => {
    vi.useFakeTimers();
    try {
      const children: (EventEmitter & {
        kill: ReturnType<typeof vi.fn>;
        stderr: PassThrough;
        stdin: PassThrough;
        stdout: PassThrough;
      })[] = [];
      const spawn = vi.fn(() => {
        const child = Object.assign(new EventEmitter(), {
          kill: vi.fn(),
          stderr: new PassThrough(),
          stdin: new PassThrough(),
          stdout: new PassThrough(),
        });
        children.push(child);
        return child as never;
      });
      const watcher = new FrontAppWatcher(spawn);

      watcher.start();
      const message = line({
        ax: true,
        front: "t3code",
        page: { route: URL },
      });
      children[0].stdout.write(message.slice(0, 10));
      children[0].stdout.write(`${message.slice(10)}\n`);

      expect(spawn).toHaveBeenCalledWith("/usr/bin/osascript", [
        "-l",
        "JavaScript",
        "-",
        expect.stringContaining("codex-controls-"),
      ]);
      expect(watcher.snapshot.t3code.route).toBe(URL);

      children[0].emit("exit");
      vi.advanceTimersByTime(3000);
      expect(spawn).toHaveBeenCalledTimes(2);

      watcher.stop();
      expect(children[1].kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("front app watcher commands", () => {
  function started() {
    const children: (EventEmitter & {
      kill: ReturnType<typeof vi.fn>;
      stderr: PassThrough;
      stdin: PassThrough;
      stdout: PassThrough;
    })[] = [];
    const args: string[][] = [];
    const watcher = new FrontAppWatcher((_command, list) => {
      args.push([...list]);
      const child = Object.assign(new EventEmitter(), {
        kill: vi.fn(),
        stderr: new PassThrough(),
        stdin: new PassThrough(),
        stdout: new PassThrough(),
      });
      children.push(child);
      return child as never;
    });
    watcher.start();
    return { args, children, watcher };
  }

  it("writes a private command file and resolves with the result", async () => {
    const { args, children, watcher } = started();
    const directory = args[0][3];
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);

    const result = watcher.runComposer({
      app: "t3code",
      composer: 0,
      effort: "high",
      model: "gpt-6.2-sol",
      route: URL,
    });
    const command = JSON.parse(
      fs.readFileSync(path.join(directory, "command.json"), "utf8"),
    );
    expect(command).toMatchObject({
      app: "t3code",
      effort: "high",
      model: "gpt-6.2-sol",
      route: URL,
    });

    children[0].stdout.write(
      `${line({ result: { description: "GPT-6.2-Sol, High", id: command.id } })}\n`,
    );
    await expect(result).resolves.toBe("GPT-6.2-Sol, High");
    expect(watcher.snapshot.t3code.composer).toBe("GPT-6.2-Sol, High");
    watcher.stop();
    expect(fs.existsSync(directory)).toBe(false);
  });

  it("rejects with the error of the command", async () => {
    const { args, children, watcher } = started();
    const result = watcher.runComposer({
      app: "t3code",
      composer: 0,
      effort: "x",
      model: "m",
      route: URL,
    });
    const { id } = JSON.parse(
      fs.readFileSync(path.join(args[0][3], "command.json"), "utf8"),
    );
    children[0].stdout.write(
      `${line({ result: { error: "T3 Code has no model m.", id } })}\n`,
    );
    await expect(result).rejects.toThrow("T3 Code has no model m.");
    watcher.stop();
  });

  it("rejects a command when the watcher process ends", async () => {
    const { children, watcher } = started();
    const result = watcher.runComposer({
      app: "chatgpt",
      composer: 0,
      effort: "x",
      model: "m",
      route: "Upgrade",
    });
    children[0].emit("exit");
    await expect(result).rejects.toThrow("ChatGPT did not apply the change.");
    watcher.stop();
  });

  it("puts the result label on the page of the command app", async () => {
    const { args, children, watcher } = started();
    const result = watcher.runComposer({
      app: "chatgpt",
      composer: 1,
      effort: "low",
      model: "gpt-6.2-sol",
      route: "Upgrade",
    });
    const { id } = JSON.parse(
      fs.readFileSync(path.join(args[0][3], "command.json"), "utf8"),
    );
    children[0].stdout.write(
      `${line({ result: { description: "GPT-6.2 Sol Light", id } })}\n`,
    );

    await expect(result).resolves.toBe("GPT-6.2 Sol Light");
    expect(watcher.snapshot.chatgpt.composer).toBe("GPT-6.2 Sol Light");
    expect(watcher.snapshot.t3code.composer).toBeUndefined();
    watcher.stop();
  });

  it("toggles a Claude panel and keeps the Claude label", async () => {
    const { args, children, watcher } = started();
    const result = watcher.runPanel({ app: "claude", panel: "Terminal" });
    const command = JSON.parse(
      fs.readFileSync(path.join(args[0][3], "command.json"), "utf8"),
    );
    expect(command).toMatchObject({ app: "claude", panel: "Terminal" });

    children[0].stdout.write(`${line({ result: { id: command.id } })}\n`);
    await expect(result).resolves.toBeUndefined();
    expect(watcher.snapshot.claude).toEqual(EMPTY);
    watcher.stop();
  });

  it("rejects a Claude panel that the page does not show", async () => {
    const { args, children, watcher } = started();
    const result = watcher.runPanel({ app: "claude", panel: "Changes" });
    const { id } = JSON.parse(
      fs.readFileSync(path.join(args[0][3], "command.json"), "utf8"),
    );
    children[0].stdout.write(
      `${line({ result: { error: "The Claude Changes panel is not available.", id } })}\n`,
    );
    await expect(result).rejects.toThrow(
      "The Claude Changes panel is not available.",
    );
    watcher.stop();
  });
});
