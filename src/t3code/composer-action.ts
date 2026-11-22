import { effortFromLabel, parseComposerLabel } from "./labels";

// JXA functions that set the model and thinking level in the T3 Code
// composer, and that toggle the T3 Code side chat. The front app watcher runs
// them, so the window and the model button are already known. They need
// AX_HELPERS.
export const COMPOSER_ACTION = `
const effortFromLabel = ${effortFromLabel.toString()};
const parseComposerLabel = ${parseComposerLabel.toString()};
function composerState(button) {
  const parsed = parseComposerLabel(string(button, "AXDescription") || "");
  return parsed === undefined
    ? undefined
    : {
        effort: parsed.effortLabel === undefined ? "default" : effortFromLabel(parsed.effortLabel),
        model: parsed.model,
      };
}
// Returns the final model button description. Throws an Error whose message
// starts with "error:" for a failure that the user can act on.
function applyComposer(application, button, request) {
  const fail = (message) => {
    throw new Error("error:" + message);
  };
  const isOpen = () => string(button, "AXExpanded") === "true";
  // The picker opens in a layer of the page. The button links to it.
  const picker = () => {
    const linked = copy(button, "AXLinkedUIElements");
    return linked !== undefined && !linked.isNil() && linked.isKindOfClass($.NSArray) && linked.count > 0
      ? linked.objectAtIndex(0)
      : undefined;
  };
  const open = () => {
    if (isOpen() && picker() !== undefined) return picker();
    press(button);
    if (!waitFor(() => isOpen() && picker() !== undefined, 1.5)) fail("The T3 Code model picker did not open.");
    return picker();
  };
  const close = () => {
    if (!isOpen()) return;
    press(button);
    waitFor(() => !isOpen(), 1);
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
    const before = composerState(button);
    if (before === undefined) fail("T3 Code shows no model.");

    if (normalizeLabel(before.model) !== normalizeLabel(request.model)) {
      let root = open();
      const isRow = (e) => {
        const value = string(e, "AXValue") || "";
        const separator = value.indexOf(" , ");
        return separator > 0 && normalizeLabel(value.slice(0, separator)) === normalizeLabel(request.model);
      };
      let row = find(root, isRow);
      if (row === undefined) {
        const tabs = findAll(root, (e) => string(e, "AXRole") === "AXCheckBox" && string(e, "AXValue") !== "1");
        for (const tab of tabs) {
          press(tab);
          waitFor(() => (row = find(picker() || root, isRow)) !== undefined, 0.6);
          if (row !== undefined) break;
        }
      }
      if (row === undefined) fail("T3 Code has no model " + request.model + ".");
      press(row);
      waitFor(() => {
        const now = composerState(button);
        return now !== undefined && normalizeLabel(now.model) === normalizeLabel(request.model);
      }, 1.5);
    }

    const now = composerState(button);
    if (request.effort !== "default" && (now === undefined || now.effort !== request.effort)) {
      const root = open();
      // The first choice group of the picker holds the thinking levels.
      const group = find(root, (e) => string(e, "AXRole") === "AXRadioGroup");
      const choice =
        group === undefined
          ? undefined
          : find(group, (e) => string(e, "AXRole") === "AXRadioButton" && effortFromLabel(string(e, "AXTitle") || "") === request.effort);
      if (choice === undefined) fail("The model has no " + request.effort + " thinking choice.");
      press(choice);
      waitFor(() => {
        const state = composerState(button);
        return state !== undefined && state.effort === request.effort;
      }, 1.5);
    }
  } finally {
    close();
    restoreFocus();
  }
  return string(button, "AXDescription") || "";
}
// T3 Code has no command for a side chat. A side chat is a surface of the
// right panel, so the shortcut closes an open side chat, or opens the right
// panel and adds a side chat to it. The message field of a new side chat gets
// the focus.
function toggleT3SideChat(area) {
  const fail = (message) => {
    throw new Error("error:" + message);
  };
  const described = (role, description) => (e) =>
    string(e, "AXRole") === role && string(e, "AXDescription") === description;
  const titled = (role, prefix) => (e) => string(e, "AXRole") === role && (string(e, "AXTitle") || "").startsWith(prefix);
  const closeButton = () => findInPage(area, described("AXButton", "Close side chat"));
  const open = closeButton();
  if (open !== undefined) {
    if (!press(open)) fail("T3 Code did not close the side chat.");
    return;
  }
  const panel = findInPage(area, (e) => string(e, "AXSubrole") === "AXToggleButton" && string(e, "AXDescription") === "Toggle right panel");
  if (panel === undefined) fail("The T3 Code side chat is not available here.");
  const opened = string(panel, "AXValue") !== "1";
  if (opened) press(panel);
  const unavailable = () => {
    if (opened) press(panel);
    fail("The T3 Code side chat is not available in this thread.");
  };
  // An empty right panel shows a "Side chat" button. A panel with other
  // surfaces adds one through its "Add panel surface" menu.
  let start;
  let add;
  waitFor(() => {
    start = findInPage(area, titled("AXButton", "Side chat"));
    add = findInPage(area, described("AXPopUpButton", "Add panel surface"));
    return start !== undefined || add !== undefined;
  }, 1.5);
  if (start === undefined && add !== undefined) {
    press(add);
    let menu;
    waitFor(() => {
      const list = copy(add, "AXLinkedUIElements");
      menu = list !== undefined && !list.isNil() && list.isKindOfClass($.NSArray) && list.count > 0 ? list.objectAtIndex(0) : undefined;
      return menu !== undefined && (start = find(menu, titled("AXMenuItem", "Side chat"))) !== undefined;
    }, 1);
    if (start === undefined || string(start, "AXEnabled") === "false") {
      if (string(add, "AXExpanded") === "true") press(add);
      unavailable();
    }
  }
  if (start === undefined || string(start, "AXEnabled") === "false") unavailable();
  press(start);
  let close;
  if (!waitFor(() => (close = closeButton()) !== undefined, 1.5)) unavailable();
  const parent = copy(close, "AXParent");
  const field = parent === undefined || parent.isNil() ? undefined : find(parent, (e) => string(e, "AXRole") === "AXTextArea");
  if (field !== undefined) $.AXUIElementSetAttributeValue(field, $("AXFocused"), $.NSNumber.numberWithBool(true));
}
`;
