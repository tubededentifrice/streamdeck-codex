# Codex Controls for Stream Deck

Codex Controls is a macOS Stream Deck plug-in for the Codex desktop app. It
changes the model or thinking level for the selected local Codex task.

Each key accepts one or more configured values:

- One value makes the key a direct set control.
- Two or more values make the key cycle through the configured values.

The key shows the configured target and the current next-turn value. This makes
a mismatch visible before you press the key.

## Current scope

This first version controls local Codex tasks only. It does not connect through
SSH and it does not control remote tasks. Codex desktop interfaces used for task
control can change between Codex releases. Treat this integration as a local
compatibility layer, not as a stable public Codex API.

A successful change applies to the selected task's next turn. It does not
change a response that Codex is already generating.

## Configure keys

Drag one of these actions from **Codex Controls** to a key:

- **Model** changes only the model.
- **Thinking** changes only the thinking level.
- **Preset** changes the model and thinking level together.

Select the key in Stream Deck and edit its ordered value list. Use the short
label for the key display. Use Codex identifiers such as `gpt-5.6-sol` and
thinking values such as `medium` or `high`.

One value makes a direct set key. Two or more values make a cycle key. If the
current value is not in the list, the first press selects the first value. The
key always shows the live current value and the value that the next press will
set.

## Requirements

- macOS
- Codex desktop
- Elgato Stream Deck 7.1 or later
- Node.js 24

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
- `src/codex/` contains local Codex task discovery, reads, and updates.
- `src/ui/` creates key images and status displays.
- `src/domain/` parses and validates property-inspector settings.
- `com.courcelle.codex-controls.sdPlugin/` contains the manifest, property
  inspector, and image assets.
- `rollup.config.mjs` builds the TypeScript entry point into the plug-in bundle.

Keep Stream Deck events, Codex access, settings, and rendering separate. A new
control should normally add a value definition and an action without changing
the local Codex transport.

## Quality checks

Before a commit, run the repository self-review workflow and all available
package checks. At minimum, build and validate the plug-in:

```sh
npm run build
npx streamdeck validate com.courcelle.codex-controls.sdPlugin --no-update-check
```

To verify read-only access to the selected local Codex task, keep a task open in
the Codex desktop app and run:

```sh
npm run smoke:codex
```

## License

This project is available under the [MIT License](LICENSE).
