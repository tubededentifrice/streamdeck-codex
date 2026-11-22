import {
  claudeButtonLabel,
  claudeEffort,
  claudeModelMatches,
  parseClaudeLabel,
} from "./labels";

// JXA functions that set the model and effort in a Claude composer and toggle
// the Claude Code session panels. The front app watcher runs them, so the
// window and the model button are already known. They need AX_HELPERS.
//
// The model button opens a menu: the main models, an "Effort" item with a
// submenu, and a "More models" item with a submenu. Each item has AXPress, so
// Claude can stay in the background.
export const CLAUDE_ACTION = `
const claudeButtonLabel = ${claudeButtonLabel.toString()};
const claudeEffort = ${claudeEffort.toString()};
const claudeModelMatches = ${claudeModelMatches.toString()};
const parseClaudeLabel = ${parseClaudeLabel.toString()};
function isClaudeButton(element) {
  return (string(element, "AXTitle") || "").startsWith("Model: ");
}
function claudeLabel(button) {
  const texts = children(button)
    .filter((child) => string(child, "AXRole") === "AXStaticText")
    .map((child) => string(child, "AXValue") || "");
  return claudeButtonLabel(string(button, "AXTitle") || "", texts);
}
// Returns the final model button label. Throws an Error whose message starts
// with "error:" for a failure that the user can act on.
function applyClaude(application, button, request) {
  const fail = (message) => {
    throw new Error("error:" + message);
  };
  const state = () => {
    const parsed = parseClaudeLabel(claudeLabel(button) || "");
    return parsed === undefined
      ? undefined
      : { effort: parsed.effortLabel === undefined ? undefined : claudeEffort(parsed.effortLabel), model: parsed.model };
  };
  const isOpen = () => string(button, "AXExpanded") === "true";
  const linked = (element) => {
    const list = copy(element, "AXLinkedUIElements");
    return list !== undefined && !list.isNil() && list.isKindOfClass($.NSArray) && list.count > 0
      ? list.objectAtIndex(0)
      : undefined;
  };
  const items = (root) => (root === undefined ? [] : findAll(root, (e) => string(e, "AXRole") === "AXMenuItem"));
  const title = (item) => string(item, "AXTitle") || "";
  const isEffortItem = (item) => title(item).startsWith("Effort") && string(item, "AXHasPopup") === "true";
  const isMoreItem = (item) => title(item) === "More models";
  const open = () => {
    if (!isOpen()) press(button);
    if (!waitFor(() => isOpen() && linked(button) !== undefined, 1.5)) fail("The Claude model picker did not open.");
    return linked(button);
  };
  // A submenu opens next to its item. The item links to it.
  const openSubmenu = (item) => {
    if (string(item, "AXExpanded") !== "true") press(item);
    let menu;
    waitFor(() => (menu = linked(item)) !== undefined && items(menu).length > 0, 1);
    return menu;
  };
  const close = () => {
    if (!isOpen()) return;
    press(button);
    if (!waitFor(() => !isOpen(), 0.5)) {
      const menu = linked(button);
      if (menu !== undefined) $.AXUIElementPerformAction(menu, $("AXCancel"));
      waitFor(() => !isOpen(), 0.5);
    }
  };
  // Dialogs open in the "portal-root" layer, near the top of the page.
  const page = (() => {
    let element = button;
    for (let depth = 0; depth < 80 && element !== undefined && !element.isNil(); depth += 1) {
      if (string(element, "AXRole") === "AXWebArea") return element;
      element = copy(element, "AXParent");
    }
    return undefined;
  })();
  const alertDialog = () => {
    if (page === undefined) return undefined;
    for (const top of children(page))
      for (const layer of children(top)) {
        if (string(layer, "AXDOMIdentifier") !== "portal-root") continue;
        const dialog = find(layer, (e) => string(e, "AXSubrole") === "AXApplicationAlertDialog");
        if (dialog !== undefined) return dialog;
      }
    return undefined;
  };
  const focused = copy(application, "AXFocusedUIElement");
  const selection = focused === undefined ? undefined : copy(focused, "AXSelectedTextRange");
  const restoreFocus = () => {
    if (focused === undefined || focused.isNil() || focused.isEqual(button)) return;
    $.AXUIElementSetAttributeValue(focused, $("AXFocused"), $.NSNumber.numberWithBool(true));
    if (selection !== undefined && !selection.isNil())
      $.AXUIElementSetAttributeValue(focused, $("AXSelectedTextRange"), selection);
  };
  try {
    const before = state();
    if (before === undefined) fail("Claude shows no model.");

    if (!claudeModelMatches(before.model, request.model)) {
      const menu = open();
      const isModel = (item) => !isEffortItem(item) && !isMoreItem(item) && claudeModelMatches(title(item), request.model);
      let row = items(menu).find(isModel);
      if (row === undefined) {
        const more = items(menu).find(isMoreItem);
        if (more !== undefined) row = items(openSubmenu(more)).find(isModel);
      }
      if (row === undefined) fail("Claude has no model " + request.model + ".");
      press(row);
      waitFor(() => {
        const now = state();
        return now !== undefined && claudeModelMatches(now.model, request.model);
      }, 1.5);
      close();
    }

    const now = state();
    if (request.effort !== "default" && (now === undefined || now.effort !== request.effort)) {
      const effort = items(open()).find(isEffortItem);
      const choice =
        effort === undefined ? undefined : items(openSubmenu(effort)).find((item) => claudeEffort(title(item)) === request.effort);
      if (choice === undefined) fail("The model has no " + request.effort + " thinking choice.");
      press(choice);
      let dialog;
      waitFor(() => {
        const value = state();
        if (value !== undefined && value.effort === request.effort) return true;
        dialog = alertDialog();
        return dialog !== undefined;
      }, 1.5);
      // Claude can ask to confirm a high effort, such as "Use Extra". The key
      // asked for this effort, so the action confirms it.
      if (dialog !== undefined) {
        const buttons = findAll(dialog, (e) => string(e, "AXRole") === "AXButton");
        const confirm = buttons.find((e) => {
          const label = title(e);
          return label.startsWith("Use ") && claudeEffort(label.slice(4)) === request.effort;
        });
        if (confirm === undefined) {
          const cancel = buttons.find((e) => title(e) === "Close");
          if (cancel !== undefined) press(cancel);
          fail("Claude did not accept the " + request.effort + " thinking choice.");
        }
        press(confirm);
        waitFor(() => {
          const value = state();
          return value !== undefined && value.effort === request.effort;
        }, 1.5);
      }
    }
  } finally {
    close();
    restoreFocus();
  }
  return claudeLabel(button) || "";
}
// Toggles a Claude Code session panel, such as "Terminal", in the session
// tools of the page.
function toggleClaudePanel(area, panel) {
  const toggle = find(
    area,
    (e) => string(e, "AXSubrole") === "AXToggleButton" && string(e, "AXTitle") === panel,
  );
  if (toggle === undefined) throw new Error("error:The Claude " + panel + " panel is not available.");
  if (!press(toggle)) throw new Error("error:Claude did not open the " + panel + " panel.");
}
`;
