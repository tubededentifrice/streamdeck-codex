import streamDeck from "@elgato/streamdeck";

import {
  ModelAction,
  PresetAction,
  ThinkingAction,
} from "./actions/codex-actions";
import { codexController } from "./codex/controller";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new ModelAction());
streamDeck.actions.registerAction(new ThinkingAction());
streamDeck.actions.registerAction(new PresetAction());

codexController.start();
await streamDeck.connect();
