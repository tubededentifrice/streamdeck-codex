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
