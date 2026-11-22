# Changelog

This file records the user-visible changes in Codex Controls.

## Unreleased

- Fit the text to the key by default. A long model name breaks into lines.
  Clear **Fit text to key** to set the text sizes.
- Show the next value without the NEXT or SET prefix and without the dot, in a
  larger font. A Preset key shows the next model and thinking level on two
  lines.
- Hide the action title on new keys.
- Name a model without a configured label from its identifier, for example
  "Sol 6.2" for `gpt-6.2-sol` and "Opus 5.5" for `claude-opus-5-5`.
- List the models that tasks used in Model and Preset settings. Click a model
  to add it to the key.
- Sort the built-in color presets by hue.
- Control Claude for macOS through its window: new and sent chats, Claude Code
  sessions, and cloud sessions. Shortcut keys toggle the Claude Code session
  panels.
- Toggle the side chat with the Shortcut key in Claude and in T3 Code.
- Make the Review shortcut a toggle in ChatGPT, and show **UNAVAILABLE** in a
  chat without a local project.
- Stop the app watcher process when the plug-in restarts. Before, each restart
  left one more watcher process that kept running.
- Do not show a false CODEX OFFLINE error on setting keys when the plug-in
  starts with ChatGPT or T3 Code in front.
- Add a Single Preset control. It sets one model and thinking level. It has a
  border while the task uses this preset, and fades without a border while the
  task uses other values. Set the fade in **Inactive fade** (75% by default).
- Control ChatGPT for macOS through its window: new chats, remote chats, and
  side chats.
- Change the ChatGPT model through the model list with keyboard input, also
  when ChatGPT does not expose Accessibility actions.

## 0.1.0 - 2026-08-29

- Prepare the plug-in information, artwork, screenshots, support text, and
  release process for publication.
- Add Model, Thinking, and Preset controls.
- Add a Shortcut control for Review, Terminal, Browser, Files, and Side chat.
- Hide the unsupported Add value control in Shortcut settings.
- Change selected local task settings and show selected remote task settings.
- Show the current value and the next value on each setting key.
- Add 16 fixed color presets and shared custom color presets.
