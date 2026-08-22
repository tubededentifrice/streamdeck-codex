---
name: selfreview
description: Review the current Stream Deck plug-in changes for defects, fix all real findings, and run the project quality gates before a commit.
---

# Self-review

Use this skill after each non-trivial change and before each commit. The normal
workflow is hands-off autofix. Do not ask the user to approve routine fixes.

## Workflow

1. Gather the complete change and its intent.
2. Review the change as a skeptical maintainer and Stream Deck user.
3. Record only findings that are specific and reproducible.
4. Fix every bug, missing requirement, and material risk.
5. Run the quality gates.
6. Review the final diff again. Report the fixes and gate results to the agent
   that owns the task.

Do not create another self-review task for self-review fixes.

## Gather the change

Confirm the branch and working-tree state:

```sh
git status --short --branch
git log --oneline --decorate -10
git diff --stat
git diff
git diff --cached
```

If the work is on a branch with commits beyond `main`, also inspect:

```sh
git diff --stat main...HEAD
git diff main...HEAD
git log --oneline main...HEAD
```

Read the user request, `AGENTS.md`, the manifest, the changed source files, and
the related tests. Review against the intended result, not only code style.

## Deep review

For each changed path, check these areas.

### Correctness and state

- Trace key press to setting selection, Codex update, read-back, and key render.
- Test empty, one-value, multi-value, invalid, duplicate, and stale settings.
- Check cycle order and wraparound. Check undefined and unexpected SDK payloads.
- Confirm that state is isolated per action instance, device, and profile.
- Confirm that async refreshes cannot overwrite a newer display or update.
- Confirm that a failed update does not appear successful.
- Confirm that the displayed current value comes from verified Codex state.

### Codex compatibility and safety

- Keep all Codex desktop interface details behind the Codex adapter.
- Reject or report missing tasks, unsupported models or thinking levels,
  unavailable sockets, timeouts, malformed responses, and Codex restarts.
- Check file and socket ownership assumptions. Do not expose tokens, task
  content, local paths, or other sensitive data in logs or key images.
- For remote tasks, use Codex desktop IPC only. Do not add SSH, host settings,
  remote command execution, or global-default changes. If IPC is read-only for
  a remote task, permit exact and verified macOS Accessibility control of the
  Codex model menu.
- Confirm that updates affect the selected task's next turn only.

### Stream Deck SDK

- Match action UUIDs in decorators, manifest entries, and property inspectors.
- Check `willAppear`, key events, settings events, disappear events, and device
  reconnect behavior.
- Await SDK calls when ordering matters. Catch rejected promises at event
  boundaries so that the plug-in stays alive.
- Check manifest schema, supported controllers, platform, Node.js version,
  image paths, and property-inspector paths.
- Confirm that SVG or data-URL rendering is valid, escaped, bounded to the key,
  and readable for long labels and high-DPI devices.
- Check custom color validation, global sharing, missing preset fallback, and
  contrast for every built-in color preset.

### Extensibility and maintainability

- Keep actions, Codex transport, settings validation, and rendering separate.
- Avoid model-specific branches when a validated value definition can express
  the behavior.
- Check public types and errors for consistent names and useful messages.
- Remove unused scaffold code, dead assets, debug logs, and unsafe type casts.
- Add focused tests for new behavior and failure paths.

### Packaging and user experience

- Confirm that a one-value list sets directly and a longer list cycles in the
  configured order.
- Make current, target, mismatch, busy, success, and failure states clear.
- Do not claim that a change affects a response already in progress.
- Check that a clean clone can install, build, validate, and link the plug-in.
- Check that generated bundles, logs, packages, secrets, and local Codex data
  stay untracked.

## Findings and fixes

Use these severities:

- `BUG`: causes an error, wrong state, or false success.
- `MISSING`: leaves a requested behavior or necessary test incomplete.
- `RISKY`: can cause a material failure under a realistic condition.
- `NIT`: is optional and has no material effect.

Each finding must name a file and line, explain how it occurs, and state the
fix. Do not invent findings to fill a list. Apply all `BUG`, `MISSING`, and
`RISKY` fixes. Apply a `NIT` only when the change is small and clearly safe.

After fixes, inspect the new diff and repeat the review until no material
finding remains.

## Quality gates

Use the scripts defined in `package.json`. Run each available gate in this
order:

```sh
npm run format --if-present
npm run lint --if-present
npm test --if-present
npm run build
npx streamdeck validate com.courcelle.codex-controls.sdPlugin --no-update-check
```

If a command changes files, review those changes and rerun the affected gates.
Do not hide a failure. Fix failures caused by the task. Report an unrelated or
environmental failure with the exact command and error.

Finish with:

```sh
git status --short
git diff --check
```

The task-owning agent commits the implementation and self-review fixes together
directly to `main` after all applicable gates pass.
