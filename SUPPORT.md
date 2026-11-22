# Codex Controls support

Use the [GitHub issue tracker](https://github.com/tubededentifrice/codex-streamdeck/issues)
to report a problem or request a feature.

## Before you report a problem

1. Confirm that ChatGPT, Claude, Codex desktop, or T3 Code is open.
2. Select a chat in ChatGPT, a chat or session in Claude, a normal Codex task,
   or a T3 Code thread. A Codex
   desktop side chat uses its parent task.
3. Confirm that Stream Deck is version 7.1 or later.
4. Restart the Codex Controls plug-in.

## Information to include

- The macOS, ChatGPT, Claude, Codex desktop or T3 Code, and Stream Deck
  versions.
- The action type: Model, Thinking, Preset, or Shortcut.
- Whether the selected task is local or remote.
- The text that the key shows.
- The steps that reproduce the problem.

Do not include task content, access tokens, SSH keys, or other private data.

## Data use

Codex Controls has no analytics and no advertising. It reads next-turn settings
for local and remote tasks. It changes these settings for local tasks. It does
not send task content to the plug-in author.

For T3 Code, the plug-in reads the T3 Code window address and model button
through macOS Accessibility. It changes the model through the T3 Code model
picker, and it opens side chats in the right panel. It does not connect to a
T3 Code server and stores no T3 Code data.

For ChatGPT, the plug-in reads the window title and the model button through
macOS Accessibility. It changes the model and thinking level through the
ChatGPT model picker, and it reads the Changes tab for the Review shortcut. It
stores no ChatGPT data.

For Claude, the plug-in reads the window address and the model button through
macOS Accessibility. It changes the model and effort through the Claude model
picker, and it toggles panels through the Claude View menu. It does not
connect to Claude servers and stores no Claude data.
