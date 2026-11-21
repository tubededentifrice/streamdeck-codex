import { parseChatGPTLabel, parsePowerAnnouncement } from "./labels";

// JXA functions that set the model and thinking level in a ChatGPT composer.
// The front app watcher runs them, so the window and the model button are
// already known. They need AX_HELPERS.
//
// The model picker has a "Select model" view and a "Power" slider. The slider
// has no Accessibility value or action. It takes the Left and Right arrow keys,
// and it announces its value, such as "GPT-6.2 Sol Extended, 3 of 4.", in a
// status element. The keys go to the ChatGPT process, so ChatGPT can stay in
// the background.
export const CHATGPT_ACTION = `
const parseChatGPTLabel = ${parseChatGPTLabel.toString()};
const parsePowerAnnouncement = ${parsePowerAnnouncement.toString()};
const CHATGPT_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"];
const KEY_LEFT = 123;
const KEY_RIGHT = 124;
// The button shows the title of the picker view while the picker is open.
function chatgptLabel(button) {
  return string(button, "AXExpanded") === "true" ? undefined : string(button, "AXTitle");
}
function postKey(pid, code) {
  for (const down of [true, false])
    $.CGEventPostToPid(pid, $.CGEventCreateKeyboardEvent(null, code, down));
}
// Returns the final model button title. Throws an Error whose message starts
// with "error:" for a failure that the user can act on.
function applyChatGPT(application, pid, button, request) {
  const fail = (message) => {
    throw new Error("error:" + message);
  };
  const sameModel = (model) => normalizeLabel(model) === normalizeLabel(request.model);
  const isOpen = () => string(button, "AXExpanded") === "true";
  // The linked menu can go away between two reads while the picker closes.
  const menu = () => {
    try {
      const linked = copy(button, "AXLinkedUIElements");
      return linked !== undefined && !linked.isNil() && linked.isKindOfClass($.NSArray) && linked.count > 0
        ? linked.objectAtIndex(0)
        : undefined;
    } catch (error) {
      return undefined;
    }
  };
  const open = () => {
    if (!isOpen()) press(button);
    if (!waitFor(() => isOpen() && menu() !== undefined, 1.5)) fail("The ChatGPT model picker did not open.");
    return menu();
  };
  // The picker keeps the model list view for about 0.5 s after it closes.
  let modelView = false;
  const close = () => {
    if (isOpen()) press(button);
    waitFor(() => !isOpen() && menu() === undefined, 1);
    if (modelView) pause(0.6);
    modelView = false;
  };
  const state = () => {
    close();
    waitFor(() => chatgptLabel(button) !== undefined, 1);
    return parseChatGPTLabel(chatgptLabel(button) || "");
  };
  const done = (value) =>
    value !== undefined &&
    sameModel(value.model) &&
    (request.effort === "default" || value.effort === request.effort);
  const focused = copy(application, "AXFocusedUIElement");
  const selection = focused === undefined ? undefined : copy(focused, "AXSelectedTextRange");
  const restoreFocus = () => {
    if (focused === undefined || focused.isNil() || focused.isEqual(button)) return;
    $.AXUIElementSetAttributeValue(focused, $("AXFocused"), $.NSNumber.numberWithBool(true));
    if (selection !== undefined && !selection.isNil())
      $.AXUIElementSetAttributeValue(focused, $("AXSelectedTextRange"), selection);
  };
  const isMenuItem = (title) => (e) => string(e, "AXRole") === "AXMenuItem" && string(e, "AXTitle") === title;
  // The picker shows its items after a short animation.
  const openItem = (title) => {
    open();
    let item;
    waitFor(() => {
      const root = menu();
      item = root === undefined ? undefined : find(root, isMenuItem(title));
      return item !== undefined;
    }, 1);
    return item;
  };
  try {
    let current = state();
    if (current === undefined) fail("ChatGPT shows no model.");

    // A model in the model list.
    if (!sameModel(current.model)) {
      const toggle = openItem("Select model");
      if (toggle !== undefined) {
        press(toggle);
        modelView = true;
        const isRow = (e) => {
          if (!["AXMenuItem", "AXRadioButton", "AXButton"].includes(string(e, "AXRole"))) return false;
          if (string(e, "AXTitle") === "Select model") return false;
          const names = [string(e, "AXTitle") || ""];
          for (const text of findAll(e, (child) => string(child, "AXRole") === "AXStaticText"))
            names.push(string(text, "AXValue") || "");
          return names.some((name) => name && sameModel(name));
        };
        let row;
        waitFor(() => {
          const root = menu();
          row = root === undefined ? undefined : find(root, isRow);
          return row !== undefined;
        }, 1);
        if (row !== undefined) {
          press(row);
          waitFor(() => {
            const now = isOpen() ? undefined : parseChatGPTLabel(chatgptLabel(button) || "");
            return now !== undefined && sameModel(now.model);
          }, 1.5);
        }
      }
      current = state();
    }
    if (done(current)) return chatgptLabel(button) || "";

    // The power slider. It can also hold more than one model.
    const power = openItem("Power");
    if (power === undefined) fail("ChatGPT shows no thinking choices.");
    $.AXUIElementSetAttributeValue(power, $("AXFocused"), $.NSNumber.numberWithBool(true));
    const announcement = () => {
      const root = menu();
      if (root === undefined) return undefined;
      for (const status of findAll(root, (e) => string(e, "AXSubrole") === "AXApplicationStatus")) {
        const texts = findAll(status, (e) => string(e, "AXRole") === "AXStaticText");
        const parsed = parsePowerAnnouncement(texts.map((e) => string(e, "AXValue") || "").join(" "));
        if (parsed !== undefined) return parsed;
      }
      return undefined;
    };
    let now;
    if (!waitFor(() => (now = announcement()) !== undefined, 1)) fail("ChatGPT shows no thinking choices.");
    const origin = now.position;
    let seenModel = false;
    const matches = () => {
      const value = parseChatGPTLabel(now.label);
      if (value !== undefined && sameModel(value.model)) seenModel = true;
      return done(value);
    };
    let steps = 0;
    const step = (code) => {
      steps += 1;
      if (steps > 40) fail("ChatGPT did not apply the change.");
      const before = now.position;
      postKey(pid, code);
      const moved = waitFor(() => {
        const next = announcement();
        if (next === undefined || next.position === before) return false;
        now = next;
        return true;
      }, 1);
      if (!moved) fail("ChatGPT did not apply the change.");
    };
    if (!matches()) {
      const value = parseChatGPTLabel(now.label);
      const from = value === undefined ? -1 : CHATGPT_EFFORTS.indexOf(value.effort);
      const to = CHATGPT_EFFORTS.indexOf(request.effort);
      if (value !== undefined && sameModel(value.model) && from >= 0 && to >= 0) {
        const code = to > from ? KEY_RIGHT : KEY_LEFT;
        while (!matches() && (code === KEY_RIGHT ? now.position < now.total : now.position > 1)) step(code);
      }
    }
    if (!matches()) {
      while (now.position > 1) step(KEY_LEFT);
      while (!matches() && now.position < now.total) step(KEY_RIGHT);
    }
    if (!matches()) {
      while (now.position > origin) step(KEY_LEFT);
      while (now.position < origin) step(KEY_RIGHT);
    }
    if (!matches())
      fail(
        seenModel
          ? "The model has no " + request.effort + " thinking choice."
          : "ChatGPT has no model " + request.model + ".",
      );
  } finally {
    close();
    restoreFocus();
  }
  waitFor(() => chatgptLabel(button) !== undefined, 1);
  return chatgptLabel(button) || "";
}
`;
