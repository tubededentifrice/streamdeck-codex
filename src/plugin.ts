import streamDeck from "@elgato/streamdeck";

import {
  ModelAction,
  PresetAction,
  ShortcutAction,
  ThinkingAction,
} from "./actions/codex-actions";
import { catalogSync } from "./actions/catalog-sync";
import { frontAppWatcher } from "./apps/front-app-watcher";
import { codexController } from "./codex/controller";
import { shortcutController } from "./codex/shortcut-controller";
import { styleService } from "./ui/style-service";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new ModelAction());
streamDeck.actions.registerAction(new ThinkingAction());
streamDeck.actions.registerAction(new PresetAction());
streamDeck.actions.registerAction(new ShortcutAction());

await streamDeck.connect();
await styleService.start();
frontAppWatcher.start();
let frontAppLog = "";
frontAppWatcher.onChange(() => {
  const { accessibility, app } = frontAppWatcher.snapshot;
  const line = `Agent app: ${app ?? "none"}; Accessibility: ${accessibility ? "allowed" : "denied"}.`;
  if (line === frontAppLog) return;
  frontAppLog = line;
  streamDeck.logger.info(line);
});
catalogSync.start();
codexController.start();
shortcutController.start();
// TEMP PROBE
import { execFile as probeExec } from "node:child_process";
let probeLast = "";
frontAppWatcher.onChange(() => {
  const s = frontAppWatcher.snapshot;
  const line = `PROBE snapshot index=${s.t3ComposerIndex} composer=${s.t3Composer}`;
  if (line !== probeLast) { probeLast = line; streamDeck.logger.info(line); }
});
let probeTree = "";
setInterval(() => {
  probeExec("/usr/bin/osascript", ["-l", "JavaScript", "/private/tmp/claude-501/-Volumes-External-git-streamdeck-codex/7364f001-42e7-47ef-974c-5f6c567badf8/scratchpad/side.js"], (error, stdout) => {
    const text = error ? String(error) : stdout;
    if (text.replace(/ms=\d+/, "") === probeTree) return;
    probeTree = text.replace(/ms=\d+/, "");
    streamDeck.logger.info("PROBE tree\n" + text);
  });
}, 3000);
