import { AX_HELPERS } from "../apps/ax-helpers";
import { effortFromLabel, normalizeLabel, parseComposerLabel } from "./labels";

// JXA program that sets the model and thinking level in the T3 Code composer.
// It opens the model picker, presses the model row and the thinking choice
// through Accessibility, and closes the picker. It prints the final model
// button description, or "error:" and a message.
export const COMPOSER_SCRIPT = `${AX_HELPERS}
const normalizeLabel = ${normalizeLabel.toString()};
const effortFromLabel = ${effortFromLabel.toString()};
const parseComposerLabel = ${parseComposerLabel.toString()};
let cleanup = () => undefined;
function fail(message) {
  cleanup();
  throw new Error("error:" + message);
}
function find(root, test) {
  let found;
  (function walk(element, depth) {
    if (found || depth > 40) return;
    if (test(element)) {
      found = element;
      return;
    }
    for (const child of children(element)) walk(child, depth + 1);
  })(root, 0);
  return found;
}
function findAll(root, test) {
  const found = [];
  (function walk(element, depth) {
    if (depth > 40) return;
    if (test(element)) found.push(element);
    for (const child of children(element)) walk(child, depth + 1);
  })(root, 0);
  return found;
}
function run(argv) {
  const request = JSON.parse(argv[0]);
  const application = t3Application();
  if (application === undefined) fail("T3 Code is not running.");
  const window = focusedWindow(application.element);
  const area = window === undefined ? undefined : findArea(window);
  if (area === undefined) fail("T3 Code shows no thread.");
  let button = findComposer(area);
  if (button === undefined) fail("T3 Code shows no model button.");
  // The picker opens in a layer of the window, not inside the button.
  const picker = () => find(window, (e) => string(e, "AXRole") === "AXToolbar" || string(e, "AXRole") === "AXRadioGroup");
  const isOpen = () => picker() !== undefined;
  const close = () => {
    if (!isOpen()) return;
    press(button);
    wait(() => !isOpen(), 1);
  };
  cleanup = close;
  const wait = (test, seconds) => {
    for (let waited = 0; waited < seconds; waited += 0.1) {
      if (test()) return true;
      pause(0.1);
    }
    return test();
  };
  const open = () => {
    if (isOpen()) return;
    press(button);
    if (!wait(isOpen, 1.5)) fail("The T3 Code model picker did not open.");
  };
  const current = () => {
    const parsed = parseComposerLabel(string(button, "AXDescription") || "");
    return parsed === undefined
      ? undefined
      : { effort: parsed.effortLabel === undefined ? "default" : effortFromLabel(parsed.effortLabel), model: parsed.model };
  };
  const refresh = () => {
    button = findComposer(area) || button;
  };
  const before = current();
  if (before === undefined) fail("T3 Code shows no model.");

  if (normalizeLabel(before.model) !== normalizeLabel(request.model)) {
    open();
    const isRow = (e) => {
      const value = string(e, "AXValue") || "";
      const separator = value.indexOf(" , ");
      return separator > 0 && normalizeLabel(value.slice(0, separator)) === normalizeLabel(request.model);
    };
    let row = find(window, isRow);
    if (row === undefined) {
      const toolbar = find(window, (e) => string(e, "AXRole") === "AXToolbar");
      const tabs = toolbar === undefined ? [] : findAll(copy(toolbar, "AXParent") || toolbar, (e) => string(e, "AXRole") === "AXCheckBox" && string(e, "AXValue") !== "1");
      for (const tab of tabs) {
        press(tab);
        wait(() => find(window, isRow) !== undefined, 0.6);
        row = find(window, isRow);
        if (row !== undefined) break;
      }
    }
    if (row === undefined) fail("T3 Code has no model " + request.model + ".");
    press(row);
    pause(0.4);
    refresh();
  }

  const now = current();
  if (request.effort !== "default" && (now === undefined || now.effort !== request.effort)) {
    open();
    // The first choice group of the picker holds the thinking levels.
    const group = find(window, (e) => string(e, "AXRole") === "AXRadioGroup");
    const choice =
      group === undefined
        ? undefined
        : find(group, (e) => string(e, "AXRole") === "AXRadioButton" && effortFromLabel(string(e, "AXTitle") || "") === request.effort);
    if (choice === undefined) fail("The model has no " + request.effort + " thinking choice.");
    press(choice);
    pause(0.3);
    refresh();
  }

  close();
  refresh();
  return string(button, "AXDescription") || "";
}
`;
