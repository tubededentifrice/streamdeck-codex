import { describe, expect, it, vi } from "vitest";

import { ShortcutLauncher } from "../src/codex/shortcut-launcher";

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

  it("returns a safe permission error", async () => {
    const launcher = new ShortcutLauncher(async () => {
      throw new Error("Private executable path");
    });

    await expect(launcher.open("review")).rejects.toThrow(
      "Check macOS Automation and Accessibility permissions",
    );
  });
});
