import { normalizeLabel } from "./labels";

// Accessibility helpers shared by the JXA programs. The functions are bound
// with `id` types, because the JXA bridge rejects AXUIElementRef values that
// come back from an earlier call.
export const AX_HELPERS = String.raw`
ObjC.import("AppKit");
ObjC.import("ApplicationServices");
ObjC.import("CoreGraphics");
ObjC.bindFunction("AXUIElementCreateApplication", ["id", ["int"]]);
ObjC.bindFunction("AXUIElementCopyAttributeValue", ["int", ["id", "id", "id *"]]);
ObjC.bindFunction("AXUIElementSetAttributeValue", ["int", ["id", "id", "id"]]);
ObjC.bindFunction("AXUIElementPerformAction", ["int", ["id", "id"]]);
const T3 = "com.t3tools.t3code";
const CODEX = "com.openai.codex";
const CLAUDE = "com.anthropic.claudefordesktop";
const BUNDLES = { chatgpt: CODEX, claude: CLAUDE, codex: CODEX, t3code: T3 };
function copy(element, name) {
  const ref = Ref();
  return $.AXUIElementCopyAttributeValue(element, $(name), ref) === 0 ? ref[0] : undefined;
}
function string(element, name) {
  const value = copy(element, name);
  if (value === undefined || value.isNil()) return undefined;
  if (value.isKindOfClass($.NSURL)) return value.absoluteString.js;
  if (value.isKindOfClass($.NSNumber)) return String(value.js);
  return value.isKindOfClass($.NSString) ? value.js : undefined;
}
function children(element) {
  const list = copy(element, "AXChildren");
  if (list === undefined || list.isNil() || !list.isKindOfClass($.NSArray)) return [];
  const result = [];
  for (let index = 0; index < list.count; index += 1)
    result.push(list.objectAtIndex(index));
  return result;
}
// delay() blocks without a run loop, and T3 Code then shows a stale tree.
function pause(seconds) {
  $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(seconds));
}
function press(element) {
  return $.AXUIElementPerformAction(element, $("AXPress")) === 0;
}
const normalizeLabel = ${normalizeLabel.toString()};
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
function waitFor(test, seconds) {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    if (test()) return true;
    if (Date.now() >= end) return false;
    pause(0.03);
  }
}
// ChatGPT for macOS uses the bundle ID of the earlier Codex desktop app.
function isChatGPT(app) {
  const url = app.executableURL;
  return !url.isNil() && url.lastPathComponent.js === "ChatGPT";
}
function appKey(app) {
  if (app.isNil()) return null;
  const bundle = app.bundleIdentifier.isNil() ? "" : app.bundleIdentifier.js;
  if (bundle === T3) return "t3code";
  if (bundle === CLAUDE) return "claude";
  if (bundle === CODEX) return isChatGPT(app) ? "chatgpt" : "codex";
  return null;
}
function runningPid(key) {
  const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(BUNDLES[key]);
  for (let index = 0; index < apps.count; index += 1) {
    const app = apps.objectAtIndex(index);
    if (appKey(app) === key) return app.processIdentifier;
  }
  return undefined;
}
function focusedWindow(application) {
  let window = copy(application, "AXFocusedWindow");
  if (window === undefined || window.isNil()) window = copy(application, "AXMainWindow");
  return window === undefined || window.isNil() ? undefined : window;
}
// The web page of the app window. A page URL starts with the prefix.
function findArea(window, prefix) {
  const queue = [[window, 0]];
  let visited = 0;
  while (queue.length > 0 && visited < 600) {
    const [element, depth] = queue.shift();
    visited += 1;
    if (string(element, "AXRole") === "AXWebArea") {
      const url = string(element, "AXURL");
      if (url && url.startsWith(prefix)) return element;
      continue;
    }
    if (depth < 12) for (const child of children(element)) queue.push([child, depth + 1]);
  }
  return undefined;
}
// Each composer is a message field and its model button: the first pop-up
// button after the field that passes isButton. A page can show more than one
// composer, such as a side chat. Long lists, such as the messages of a thread,
// are skipped except for their last items, so the walk stays short.
function findComposers(root, isButton) {
  const found = [];
  let text;
  let visited = 0;
  (function walk(element, depth) {
    if (depth > 60 || visited > 20000) return;
    visited += 1;
    const role = string(element, "AXRole");
    if (role === "AXTextArea") text = element;
    else if (text !== undefined && role === "AXPopUpButton" && isButton(element)) {
      found.push({ button: element, text });
      text = undefined;
      return;
    }
    const list = children(element);
    const visit = list.length > 25 ? list.slice(-3) : list;
    for (const child of visit) walk(child, depth + 1);
  })(root, 0);
  return found;
}
`;
