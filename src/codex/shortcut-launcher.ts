import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CODEX_BUNDLE_ID,
  T3CODE_BUNDLE_ID,
  type AgentApp,
} from "../apps/front-app-watcher";
import type { ShortcutId } from "../domain/settings";

type ShortcutCommand = Readonly<{
  keyCode: number;
  modifiers: readonly string[];
}>;

type Execute = (file: string, args: readonly string[]) => Promise<void>;
type ReadText = (file: string) => string;

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

// T3 Code commands and their default bindings. T3 Code has no side chat.
const T3_COMMANDS: Readonly<Partial<Record<ShortcutId, readonly string[]>>> =
  Object.freeze({
    browser: ["preview.toggle", "mod+shift+j"],
    files: ["filePicker.toggle", "mod+p"],
    review: ["diff.toggle", "mod+d"],
    terminal: ["terminal.toggle", "mod+j"],
  });

const KEY_CODES: Readonly<Record<string, number>> = Object.freeze({
  "'": 39,
  ",": 43,
  "-": 27,
  ".": 47,
  "/": 44,
  "0": 29,
  "1": 18,
  "2": 19,
  "3": 20,
  "4": 21,
  "5": 23,
  "6": 22,
  "7": 26,
  "8": 28,
  "9": 25,
  ";": 41,
  "=": 24,
  "[": 33,
  "\\": 42,
  "]": 30,
  "`": 50,
  a: 0,
  b: 11,
  c: 8,
  d: 2,
  e: 14,
  f: 3,
  g: 5,
  h: 4,
  i: 34,
  j: 38,
  k: 40,
  l: 37,
  m: 46,
  n: 45,
  o: 31,
  p: 35,
  q: 12,
  r: 15,
  s: 1,
  t: 17,
  u: 32,
  v: 9,
  w: 13,
  x: 7,
  y: 16,
  z: 6,
});

const MODIFIERS: Readonly<Record<string, string>> = Object.freeze({
  alt: "option down",
  cmd: "command down",
  command: "command down",
  control: "control down",
  ctrl: "control down",
  meta: "command down",
  mod: "command down",
  option: "option down",
  shift: "shift down",
});

export function parseT3Binding(binding: string): ShortcutCommand | undefined {
  const parts = binding.toLowerCase().split("+");
  const key = parts.pop();
  if (key === undefined || !(key in KEY_CODES)) return undefined;
  const modifiers: string[] = [];
  for (const part of parts) {
    const modifier = MODIFIERS[part];
    if (!modifier) return undefined;
    if (!modifiers.includes(modifier)) modifiers.push(modifier);
  }
  return { keyCode: KEY_CODES[key], modifiers };
}

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
  readonly #keybindingsPath: string;
  readonly #readText: ReadText;

  constructor(
    run: Execute = execute,
    options: { keybindingsPath?: string; readText?: ReadText } = {},
  ) {
    this.#execute = run;
    this.#readText =
      options.readText ?? ((file) => fs.readFileSync(file, "utf8"));
    this.#keybindingsPath =
      options.keybindingsPath ??
      path.join(
        process.env.T3CODE_HOME || path.join(os.homedir(), ".t3"),
        "userdata",
        "keybindings.json",
      );
  }

  async open(shortcut: ShortcutId, app: AgentApp = "codex"): Promise<void> {
    const command =
      app === "t3code"
        ? this.#t3Command(shortcut)
        : SHORTCUT_COMMANDS[shortcut];
    const name = app === "t3code" ? "T3 Code" : "Codex";
    if (!command)
      throw new Error(`The selected ${name} shortcut is not available.`);
    const bundle = app === "t3code" ? T3CODE_BUNDLE_ID : CODEX_BUNDLE_ID;
    const modifiers =
      command.modifiers.length > 0
        ? ` using {${command.modifiers.join(", ")}}`
        : "";
    const script = [
      `tell application id "${bundle}" to activate`,
      "delay 0.12",
      `tell application "System Events" to key code ${command.keyCode}${modifiers}`,
    ].join("\n");
    try {
      await this.#execute("/usr/bin/osascript", ["-e", script]);
    } catch {
      throw new Error(
        `${name} could not run the shortcut. Check macOS Automation and Accessibility permissions for Stream Deck.`,
      );
    }
  }

  #t3Command(shortcut: ShortcutId): ShortcutCommand | undefined {
    const entry = T3_COMMANDS[shortcut];
    if (!entry) return undefined;
    const [commandId, fallback] = entry;
    let binding = fallback;
    try {
      const value: unknown = JSON.parse(this.#readText(this.#keybindingsPath));
      if (Array.isArray(value)) {
        const rule = value.findLast(
          (item: unknown) =>
            typeof item === "object" &&
            item !== null &&
            (item as { command?: unknown }).command === commandId &&
            typeof (item as { key?: unknown }).key === "string",
        ) as { key: string } | undefined;
        if (rule) binding = rule.key;
      }
    } catch {
      // Use the T3 Code default binding.
    }
    return parseT3Binding(binding);
  }
}

export const shortcutLauncher = new ShortcutLauncher();
