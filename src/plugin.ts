import streamDeck from "@elgato/streamdeck";

import {
  ModelAction,
  PresetAction,
  ShortcutAction,
  ThinkingAction,
} from "./actions/codex-actions";
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
codexController.start();
shortcutController.start();
