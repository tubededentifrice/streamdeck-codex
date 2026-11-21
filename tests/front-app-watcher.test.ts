import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { FrontAppWatcher } from "../src/apps/front-app-watcher";

const CODEX = "com.openai.codex";
const T3 = "com.t3tools.t3code";
const URL = "t3code://app/#/412c5129-d175-4431-b1e9-1cf9dcfe2ab7/thread-0001";

function line(value: unknown): string {
  return JSON.stringify(value);
}

describe("front app watcher", () => {
  it("keeps the last frontmost supported app", () => {
    const watcher = new FrontAppWatcher();
    const listener = vi.fn();
    watcher.onChange(listener);

    watcher.apply(line({ ax: true, front: T3, running: [CODEX, T3], t3: URL }));
    expect(watcher.snapshot).toEqual({
      accessibility: true,
      app: "t3code",
      started: true,
      t3Url: URL,
    });

    watcher.apply(line({ ax: true, front: "com.elgato.StreamDeck", t3: null }));
    expect(watcher.snapshot.app).toBe("t3code");
    expect(watcher.snapshot.t3Url).toBe(URL);

    watcher.apply(line({ ax: true, front: CODEX, t3: null }));
    expect(watcher.snapshot.app).toBe("codex");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("uses the only running app before one comes to the front", () => {
    const watcher = new FrontAppWatcher();

    watcher.apply(
      line({ ax: false, front: "com.apple.finder", running: [T3] }),
    );
    expect(watcher.snapshot.app).toBe("t3code");
    watcher.apply(line({ ax: false, front: null, running: [CODEX] }));
    expect(watcher.snapshot.app).toBe("codex");

    const both = new FrontAppWatcher();
    both.apply(line({ ax: false, front: null, running: [CODEX, T3] }));
    expect(both.snapshot.app).toBeUndefined();
  });

  it("clears the T3 Code page when T3 Code shows no page", () => {
    const watcher = new FrontAppWatcher();
    watcher.apply(line({ ax: true, front: T3, t3: URL }));
    watcher.apply(line({ ax: true, front: T3, t3: null }));

    expect(watcher.snapshot.t3Url).toBeUndefined();
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
      const message = line({ ax: true, front: T3, t3: URL });
      children[0].stdout.write(message.slice(0, 10));
      children[0].stdout.write(`${message.slice(10)}\n`);

      expect(spawn).toHaveBeenCalledWith("/usr/bin/osascript", [
        "-l",
        "JavaScript",
        "-",
      ]);
      expect(watcher.snapshot.t3Url).toBe(URL);

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
