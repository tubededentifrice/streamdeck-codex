import { describe, expect, it, vi } from "vitest";

import {
  parseT3Binding,
  ShortcutLauncher,
} from "../src/codex/shortcut-launcher";

describe("Codex shortcut launcher", () => {
  it.each([
    ["review", "key code 5", "control down, shift down"],
    ["terminal", "key code 50", "control down"],
    ["browser", "key code 17", "command down"],
    ["files", "key code 14", "command down, shift down"],
    ["side-chat", "key code 1", "command down, option down"],
  ] as const)(
    "opens %s with the Codex command",
    async (shortcut, key, modifiers) => {
      const execute = vi.fn(async (file: string, args: readonly string[]) => {
        void file;
        void args;
      });
      const launcher = new ShortcutLauncher(execute);

      await launcher.open(shortcut);

      expect(execute).toHaveBeenCalledOnce();
      const [file, args] = execute.mock.calls[0];
      expect(file).toBe("/usr/bin/osascript");
      expect(args).toHaveLength(2);
      expect(args[1]).toContain('application id "com.openai.codex"');
      expect(args[1]).toContain(key);
      expect(args[1]).toContain(modifiers);
    },
  );

  it("opens a ChatGPT shortcut with the same Codex command", async () => {
    const execute = vi.fn(async (file: string, args: readonly string[]) => {
      void file;
      void args;
    });
    const launcher = new ShortcutLauncher(execute);

    await launcher.open("side-chat", "chatgpt");

    const [file, args] = execute.mock.calls[0];
    expect(file).toBe("/usr/bin/osascript");
    expect(args[1]).toContain('application id "com.openai.codex"');
    expect(args[1]).toContain("key code 1 using {command down, option down}");
  });

  it("names ChatGPT in a ChatGPT shortcut error", async () => {
    const launcher = new ShortcutLauncher(async () => {
      throw new Error("denied");
    });

    await expect(launcher.open("review", "chatgpt")).rejects.toThrow(
      "ChatGPT could not run the shortcut.",
    );
  });

  it("returns a safe permission error", async () => {
    const launcher = new ShortcutLauncher(async () => {
      throw new Error("Private executable path");
    });

    await expect(launcher.open("review")).rejects.toThrow(
      "Check macOS Automation and Accessibility permissions",
    );
  });
});

describe("T3 Code shortcut launcher", () => {
  function launcher(keybindings?: unknown) {
    const execute = vi.fn(async (file: string, args: readonly string[]) => {
      void file;
      void args;
    });
    const value = new ShortcutLauncher(execute, {
      keybindingsPath: "/keybindings.json",
      readText: () => {
        if (keybindings === undefined) throw new Error("missing");
        return JSON.stringify(keybindings);
      },
    });
    return { execute, value };
  }

  it.each([
    ["review", "key code 2", "{command down}"],
    ["terminal", "key code 38", "{command down}"],
    ["browser", "key code 38", "{command down, shift down}"],
    ["files", "key code 35", "{command down}"],
  ] as const)(
    "opens %s with the default T3 Code binding",
    async (shortcut, key, modifiers) => {
      const { execute, value } = launcher();

      await value.open(shortcut, "t3code");

      const script = execute.mock.calls[0][1][1];
      expect(script).toContain('application id "com.t3tools.t3code"');
      expect(script).toContain(`${key} using ${modifiers}`);
    },
  );

  it("uses the last custom T3 Code binding", async () => {
    const { execute, value } = launcher([
      { command: "terminal.toggle", key: "mod+j" },
      { command: "terminal.toggle", key: "ctrl+alt+t", when: "!terminalFocus" },
    ]);

    await value.open("terminal", "t3code");

    expect(execute.mock.calls[0][1][1]).toContain(
      "key code 17 using {control down, option down}",
    );
  });

  it("reports a shortcut that T3 Code does not have", async () => {
    const { execute, value } = launcher();

    await expect(value.open("side-chat", "t3code")).rejects.toThrow(
      "The selected T3 Code shortcut is not available.",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["mod+f13", "hyper+j", ""])("rejects the %s binding", (binding) => {
    expect(parseT3Binding(binding)).toBeUndefined();
  });
});
