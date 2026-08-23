# Side-chat compatibility

## Current decision

Last tested: 2026-08-23 with the Codex desktop build installed on that date.

The plug-in treats a side chat as its parent task. It shows and changes the
parent task settings. It does not claim independent side-chat control.

Codex desktop gives a side chat a live conversation ID and reports
`sideConversation: true` with a parent navigation path. However, the current
desktop IPC has these limits:

- Focus changes between open main and side editors do not emit a task-selection
  or focus event.
- The desktop settings request for a side conversation changes the parent task.
- A side conversation can be ephemeral and absent from the local state
  database.
- A separate Codex App Server process cannot take ownership of an ephemeral
  side conversation that the desktop process owns.

macOS Accessibility can report the focused editor, but editor position is not a
stable side-chat identity. A position-based proof caused false main/side
switches across valid Codex window layouts. Do not restore that method.

The supported Codex App Server has `thread/settings/update` for a real thread
ID. The open-source Codex TUI also implements side conversations as ephemeral
thread forks. These interfaces can enable future support if Codex desktop
exposes the focused side thread and lets another client update that same loaded
thread.

References:

- [Codex App Server](https://developers.openai.com/codex/app-server/)
- [Codex TUI side-thread implementation](https://github.com/openai/codex/blob/main/codex-rs/tui/src/app_server_session.rs)
- [Codex thread settings update](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/thread.rs)

## Retest procedure

Retest after a Codex desktop release changes task or chat navigation, and at
least once each quarter.

1. Build and restart the linked plug-in.
2. Run `node scripts/inspect-desktop-events.mjs`. This inspector is read-only. It
   logs IPC events but never changes the selected task or following route.
3. Open a saved local main task with model A.
4. Open a side chat with model B.
5. Alternate focus between the two editors without sending a message.
6. Confirm that IPC emits an unambiguous event with both the focused editor and
   its conversation ID. A screen coordinate or a bare Accessibility focus event
   is not sufficient.
7. Send a settings update to the side conversation through a supported Codex
   interface.
8. Confirm from a fresh side snapshot that the side setting changed.
9. Confirm from a fresh parent read that the parent setting did not change.
10. Repeat steps 3 through 9 for an unsent side chat, a saved side chat, a
    remote task, two Codex windows, and a layout with no side chat.

Enable independent side-chat control only when all checks pass. Record the new
Codex desktop version, date, event names, update method, and results in this
file.
