# Agent instructions

## Communication

- Use ASD-STE100 Simplified Technical English in user reports, documentation,
  pull requests, comments, and commit messages.
- State facts clearly. Mark assumptions and compatibility risks.

## Product scope

- Build the plug-in with the official Elgato Stream Deck SDK and CLI.
- Support local and remote tasks. Detect the selected task route through Codex
  desktop IPC. For a remote task, derive the SSH alias from the Codex host ID and
  use the remote Codex App Server. Do not add user-facing host settings.
- A control with one configured value sets that value. A control with two or
  more configured values cycles through them.
- Show the configured value and the current next-turn value on the key. Make a
  mismatch visible.
- A change applies to the selected task's next turn. It does not change a turn
  that is already in progress.
- Keep model and thinking controls easy to extend with more values and future
  Codex controls. Keep Codex access separate from Stream Deck actions and key
  rendering.
- Support T3 Code threads, including unsent drafts and threads in linked
  environments. Follow the last frontmost app, Codex desktop or T3 Code. Use
  only the local T3 Code window through macOS Accessibility: read the window
  address and the composer model button, and change values through the model
  picker. Do not connect to T3 Code servers.
- Support ChatGPT for macOS, which replaces Codex desktop with the same bundle
  ID and has no Codex desktop IPC. Control new chats, remote chats, and side
  chats through the local ChatGPT window with macOS Accessibility, in the same
  way as T3 Code. Follow the last frontmost app: ChatGPT, Codex desktop, or T3
  Code.
- Store custom color presets in Stream Deck global plug-in settings. Keep the 16
  built-in presets immutable.
- Treat a Codex desktop side chat as its parent task until the checks in
  `docs/side-chat-support.md` prove independent control is safe. A ChatGPT side
  chat has its own composer, so the keys control it directly.

## Development

- Preserve user changes and the work of other agents.
- Add or update tests for changed behavior.
- Use package scripts for repeatable build, test, lint, and format tasks.
- Validate the plug-in with the Stream Deck CLI after manifest or bundle
  changes.
- Before each completed-work commit, rebuild the plug-in and restart the linked
  local Stream Deck plug-in. The local Stream Deck must run the new bundle when
  the commit is complete.
- Do not commit generated `bin/`, log, dependency, coverage, or packaged plug-in
  files.
- Do not add secrets or local Codex data to the repository.
- Retest side-chat support after a Codex desktop release changes task or chat
  navigation, and at least once each quarter. Follow
  `docs/side-chat-support.md` and record the test date and result there.

## Completion

- Run the `.codex/skills/selfreview` workflow before each commit. Fix all real
  bug, missing, and risk findings without asking for routine approval.
- Run all quality gates that apply to the changed files.
- Commit completed work directly to `main`. Do not leave finished work only in
  the working tree.
- Push each commit immediately after it succeeds. Do not delay or batch pushes.
- Use a focused commit message that states the user-visible result.
