import { execFile } from "node:child_process";

import type { ShortcutId } from "../domain/settings";

type ShortcutCommand = Readonly<{
  keyCode: number;
  modifiers: readonly string[];
}>;

type Execute = (file: string, args: readonly string[]) => Promise<void>;

const SHORTCUT_COMMANDS: Readonly<Record<ShortcutId, ShortcutCommand>> =
  Object.freeze({
    browser: Object.freeze({ keyCode: 17, modifiers: ["command down"] }),
    files: Object.freeze({
      keyCode: 14,
      modifiers: ["command down", "shift down"],
    }),
    review: Object.freeze({
      keyCode: 5,
      modifiers: ["control down", "shift down"],
    }),
    "side-chat": Object.freeze({
      keyCode: 1,
      modifiers: ["command down", "option down"],
    }),
    terminal: Object.freeze({ keyCode: 50, modifiers: ["control down"] }),
  });

function execute(file: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 5000 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export class ShortcutLauncher {
  readonly #execute: Execute;

  constructor(run: Execute = execute) {
    this.#execute = run;
  }

  async open(shortcut: ShortcutId): Promise<void> {
    const command = SHORTCUT_COMMANDS[shortcut];
    if (!command) throw new Error("The selected Codex shortcut is invalid.");
    const script = [
      'tell application id "com.openai.codex" to activate',
      "delay 0.12",
      `tell application "System Events" to key code ${command.keyCode} using {${command.modifiers.join(", ")}}`,
    ].join("\n");
    try {
      await this.#execute("/usr/bin/osascript", ["-e", script]);
    } catch {
      throw new Error(
        "Codex could not run the shortcut. Check macOS Automation and Accessibility permissions for Stream Deck.",
      );
    }
  }
}

export const shortcutLauncher = new ShortcutLauncher();
