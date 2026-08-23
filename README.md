# Codex Controls for Stream Deck

Codex Controls is a macOS Stream Deck plug-in for the Codex desktop app. It
changes the model or thinking level for the selected Codex task.

Each key accepts one or more configured values:

- One value makes the key a direct set control.
- Two or more values make the key cycle through the configured values.

The key shows the configured target and the current next-turn value. This makes
a mismatch visible before you press the key.

## Current scope

The plug-in controls local and remote tasks through the Codex desktop app. It
detects the selected task route automatically. For a remote task, it gets the
SSH alias from Codex and connects to the remote Codex App Server. It does not
require host settings. Codex interfaces used for task control can change between
releases. Treat this integration as a compatibility layer, not as a stable public
Codex API.

The plug-in saves the last validated selected-task route in Stream Deck global
settings. This lets it restore the key display after a plug-in or Codex IPC
restart, even when Codex does not replay the current selection.

A successful change applies to the selected task's next turn. It does not
change a response that Codex is already generating.

Codex desktop side chats currently inherit their parent task in this plug-in.
The key shows and changes the parent task settings while a side chat is open.
Codex desktop does not expose a stable focus event or an independent settings
target for its ephemeral side-chat editor. See
[`docs/side-chat-support.md`](docs/side-chat-support.md) for the compatibility
status and retest procedure.

## Configure keys

Drag one of these actions from **Codex Controls** to a key:

- **Model** changes only the model.
- **Thinking** changes only the thinking level.
- **Preset** changes the model and thinking level together.

Select the key in Stream Deck and edit its ordered value list. Use the short
label for the key display. Use Codex identifiers such as `gpt-5.6-sol` and
thinking values such as `medium` or `high`.

Each configured value also selects a color preset for its border, background,
and text. The plug-in includes 16 fixed presets. You can save custom presets in
**Manage custom colors**. Custom presets are shared by all Codex Controls keys,
profiles, and devices in the same Stream Deck installation.

One value makes a direct set key. Two or more values make a cycle key. If the
current value is not in the list, the first press selects the first value. The
key always shows the live current value and the value that the next press will
set.

## Requirements

- macOS
- Codex desktop
- Elgato Stream Deck 7.1 or later
- Node.js 24

Remote setting changes use the SSH host alias that Codex reports for the
selected task. The plug-in opens `codex app-server proxy` through the existing
SSH configuration. SSH must work without an interactive password prompt, such
as with an SSH key and agent. The plug-in validates the requested model and
thinking level. It verifies the saved task settings through Codex desktop IPC.
It does not use
Accessibility, Screen Recording, OCR, or UI clicks.

## Development setup

Install dependencies:

```sh
npm install
```

Enable Stream Deck developer mode and link the plug-in once:

```sh
npx streamdeck dev
npx streamdeck link com.courcelle.codex-controls.sdPlugin
```

Start the development build. The watch command rebuilds the bundle and restarts
the plug-in after a source change:

```sh
npm run watch
```

For a one-time build and validation, run:

```sh
npm run build
npx streamdeck validate com.courcelle.codex-controls.sdPlugin --no-update-check
```

The Stream Deck log files are under
`com.courcelle.codex-controls.sdPlugin/logs/`. They are local development files
and are not committed.

## Architecture

- `src/actions/` contains Stream Deck action classes.
- `src/codex/` contains Codex task discovery, reads, and updates.
- `src/ui/` creates key images and status displays.
- `src/domain/` parses and validates property-inspector settings.
- `com.courcelle.codex-controls.sdPlugin/` contains the manifest, property
  inspector, and image assets.
- `rollup.config.mjs` builds the TypeScript entry point into the plug-in bundle.

Keep Stream Deck events, Codex access, settings, and rendering separate. A new
control should normally add a value definition and an action without changing
the Codex desktop transport.

## Quality checks

Before a commit, run the repository self-review workflow and all available
package checks. At minimum, build and validate the plug-in:

```sh
npm run build
npx streamdeck validate com.courcelle.codex-controls.sdPlugin --no-update-check
```

To verify access to a local or remote Codex task, start the test and then select
the task in the Codex desktop app:

```sh
npm run smoke:codex
```

## License

This project is available under the [MIT License](LICENSE).
