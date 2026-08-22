# Agent instructions

## Communication

- Use ASD-STE100 Simplified Technical English in user reports, documentation,
  pull requests, comments, and commit messages.
- State facts clearly. Mark assumptions and compatibility risks.

## Product scope

- Build the plug-in with the official Elgato Stream Deck SDK and CLI.
- Support local and remote tasks through Codex desktop IPC. Detect the selected
  task route automatically. Use verified macOS app control only when desktop IPC
  cannot write a remote task. Do not add SSH or host settings.
- A control with one configured value sets that value. A control with two or
  more configured values cycles through them.
- Show the configured value and the current next-turn value on the key. Make a
  mismatch visible.
- A change applies to the selected task's next turn. It does not change a turn
  that is already in progress.
- Keep model and thinking controls easy to extend with more values and future
  Codex controls. Keep Codex access separate from Stream Deck actions and key
  rendering.
- Store custom color presets in Stream Deck global plug-in settings. Keep the 16
  built-in presets immutable.

## Development

- Preserve user changes and the work of other agents.
- Add or update tests for changed behavior.
- Use package scripts for repeatable build, test, lint, and format tasks.
- Validate the plug-in with the Stream Deck CLI after manifest or bundle
  changes.
- Do not commit generated `bin/`, log, dependency, coverage, or packaged plug-in
  files.
- Do not add secrets or local Codex data to the repository.

## Completion

- Run the `.codex/skills/selfreview` workflow before each commit. Fix all real
  bug, missing, and risk findings without asking for routine approval.
- Run all quality gates that apply to the changed files.
- Commit completed work directly to `main`. Do not leave finished work only in
  the working tree.
- Use a focused commit message that states the user-visible result.
