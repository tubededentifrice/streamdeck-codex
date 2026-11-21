// Accessibility helpers shared by the JXA programs. The functions are bound
// with `id` types, because the JXA bridge rejects AXUIElementRef values that
// come back from an earlier call.
export const AX_HELPERS = String.raw`
ObjC.import("AppKit");
ObjC.import("ApplicationServices");
ObjC.bindFunction("AXUIElementCreateApplication", ["id", ["int"]]);
ObjC.bindFunction("AXUIElementCopyAttributeValue", ["int", ["id", "id", "id *"]]);
ObjC.bindFunction("AXUIElementSetAttributeValue", ["int", ["id", "id", "id"]]);
ObjC.bindFunction("AXUIElementPerformAction", ["int", ["id", "id"]]);
const T3 = "com.t3tools.t3code";
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
function t3Application() {
  const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(T3);
  if (apps.count === 0) return undefined;
  const pid = apps.objectAtIndex(0).processIdentifier;
  return { element: $.AXUIElementCreateApplication(pid), pid };
}
function focusedWindow(application) {
  let window = copy(application, "AXFocusedWindow");
  if (window === undefined || window.isNil()) window = copy(application, "AXMainWindow");
  return window === undefined || window.isNil() ? undefined : window;
}
function findArea(window) {
  const queue = [[window, 0]];
  let visited = 0;
  while (queue.length > 0 && visited < 600) {
    const [element, depth] = queue.shift();
    visited += 1;
    if (string(element, "AXRole") === "AXWebArea") {
      const url = string(element, "AXURL");
      if (url && url.startsWith("t3code:")) return element;
      continue;
    }
    if (depth < 12) for (const child of children(element)) queue.push([child, depth + 1]);
  }
  return undefined;
}
// The model button is the first untitled pop-up button with text after the
// message field. Long
// lists, such as the messages of a thread, are skipped except for their last
// items, so the walk stays short.
function findComposer(root) {
  let seenMessage = false;
  let found;
  let visited = 0;
  (function walk(element, depth) {
    if (found || depth > 60 || visited > 20000) return;
    visited += 1;
    const role = string(element, "AXRole");
    if (role === "AXTextArea") seenMessage = true;
    else if (
      seenMessage &&
      role === "AXPopUpButton" &&
      !string(element, "AXTitle") &&
      children(element).some((child) => string(child, "AXRole") === "AXStaticText")
    ) {
      found = element;
      return;
    }
    const list = children(element);
    const visit = list.length > 25 ? list.slice(-3) : list;
    for (const child of visit) walk(child, depth + 1);
  })(root, 0);
  return found;
}
`;
