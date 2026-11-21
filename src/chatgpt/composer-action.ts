import { parseChatGPTLabel, parsePowerAnnouncement } from "./labels";

// JXA functions that set the model and thinking level in a ChatGPT composer.
// The front app watcher runs them, so the window and the model button are
// already known. They need AX_HELPERS.
//
// The model picker has a "Select model" view and a "Power" slider. ChatGPT does
// not always expose AXPress on the picker elements, so the action focuses an
// element and sends a key: Space opens the picker, Return selects an item, and
// the arrow keys move the slider. The slider announces its value, such as
// "GPT-6.2 Sol Extended, 3 of 4.", in a status element. The keys go to the
// ChatGPT process, so ChatGPT can stay in the background.
export const CHATGPT_ACTION = `
const parseChatGPTLabel = ${parseChatGPTLabel.toString()};
const parsePowerAnnouncement = ${parsePowerAnnouncement.toString()};
const CHATGPT_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"];
const KEY_ESCAPE = 53;
const KEY_LEFT = 123;
const KEY_RETURN = 36;
const KEY_RIGHT = 124;
const KEY_SPACE = 49;
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
  // A key goes only to an element that has the focus, so it cannot type into
  // the message field.
  const focus = (element) => {
    $.AXUIElementSetAttributeValue(element, $("AXFocused"), $.NSNumber.numberWithBool(true));
    if (!waitFor(() => string(element, "AXFocused") === "true", 0.5))
      fail("ChatGPT did not accept the keyboard focus.");
  };
  const activate = (element, code) => {
    focus(element);
    postKey(pid, code);
  };
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
    if (!isOpen()) activate(button, KEY_SPACE);
    if (!waitFor(() => isOpen() && menu() !== undefined, 1.5)) fail("The ChatGPT model picker did not open.");
    return menu();
  };
  // The picker keeps the model list view for about 0.5 s after it closes.
  let modelView = false;
  // Escape closes the picker from inside the menu. It never goes to a message
  // field, where it can stop a running turn.
  const close = () => {
    if (isOpen()) {
      const inside = copy(application, "AXFocusedUIElement");
      if (inside !== undefined && !inside.isNil() && string(inside, "AXRole") !== "AXTextArea") {
        postKey(pid, KEY_ESCAPE);
        waitFor(() => !isOpen(), 0.5);
      }
      if (isOpen()) activate(button, KEY_SPACE);
    }
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
        activate(toggle, KEY_RETURN);
        modelView = true;
        const isItem = (e) =>
          ["AXMenuItem", "AXRadioButton", "AXButton"].includes(string(e, "AXRole")) &&
          string(e, "AXTitle") !== "Select model";
        const isRow = (e) => {
          if (!isItem(e)) return false;
          const names = [string(e, "AXTitle") || ""];
          for (const text of findAll(e, (child) => string(child, "AXRole") === "AXStaticText"))
            names.push(string(text, "AXValue") || "");
          return names.some((name) => name && sameModel(name));
        };
        let row;
        let listed = false;
        waitFor(() => {
          const root = menu();
          row = root === undefined ? undefined : find(root, isRow);
          listed = root !== undefined && find(root, isItem) !== undefined;
          return row !== undefined;
        }, 1);
        if (row === undefined && listed) fail("ChatGPT has no model " + request.model + ".");
        if (row !== undefined) {
          activate(row, KEY_RETURN);
          // The picker closes or goes back to its main view, which shows the
          // selected model in the "Select model" item.
          waitFor(() => {
            if (!isOpen()) {
              const now = parseChatGPTLabel(chatgptLabel(button) || "");
              return now !== undefined && sameModel(now.model);
            }
            const root = menu();
            const item = root === undefined ? undefined : find(root, isMenuItem("Select model"));
            if (item === undefined) return false;
            modelView = false;
            return findAll(item, (e) => string(e, "AXRole") === "AXStaticText").some((e) =>
              sameModel(string(e, "AXValue") || ""),
            );
          }, 1.5);
        }
      }
      current = state();
    }
    if (done(current)) return chatgptLabel(button) || "";

    // The power slider. It can also hold more than one model.
    const power = openItem("Power");
    if (power === undefined) fail("ChatGPT shows no thinking choices.");
    focus(power);
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
    // A step that does not move reaches the end of the slider, such as a
    // locked position.
    let steps = 0;
    const step = (code) => {
      steps += 1;
      if (steps > 40 || string(power, "AXFocused") !== "true") return false;
      const before = now.position;
      postKey(pid, code);
      return waitFor(() => {
        const next = announcement();
        if (next === undefined || next.position === before) return false;
        now = next;
        return true;
      }, 0.6);
    };
    if (!matches()) {
      const value = parseChatGPTLabel(now.label);
      const from = value === undefined ? -1 : CHATGPT_EFFORTS.indexOf(value.effort);
      const to = CHATGPT_EFFORTS.indexOf(request.effort);
      if (value !== undefined && sameModel(value.model) && from >= 0 && to >= 0) {
        const code = to > from ? KEY_RIGHT : KEY_LEFT;
        while (!matches() && (code === KEY_RIGHT ? now.position < now.total : now.position > 1) && step(code));
      }
    }
    if (!matches()) {
      while (now.position > 1 && step(KEY_LEFT));
      while (!matches() && now.position < now.total && step(KEY_RIGHT));
    }
    if (!matches()) {
      while (now.position > origin && step(KEY_LEFT));
      while (now.position < origin && step(KEY_RIGHT));
      if (now.position !== origin) fail("ChatGPT did not apply the change.");
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
