import streamDeck from "@elgato/streamdeck";

import {
  ModelAction,
  PresetAction,
  ThinkingAction,
} from "./actions/codex-actions";
import { codexController } from "./codex/controller";
import { styleService } from "./ui/style-service";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new ModelAction());
streamDeck.actions.registerAction(new ThinkingAction());
streamDeck.actions.registerAction(new PresetAction());

await streamDeck.connect();
await styleService.start();
codexController.start();
