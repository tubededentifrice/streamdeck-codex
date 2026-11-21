// JXA program run by /usr/bin/osascript. It prints one JSON line each time the
// frontmost app, the running supported apps, the Accessibility trust, or the
// T3 Code page URL changes.
// The cached web area keeps each poll to two AX copies, because JXA does not
// release CF results; FrontAppWatcher also restarts this process periodically.
export const FRONT_APP_SCRIPT = String.raw`
ObjC.import("AppKit");
ObjC.import("ApplicationServices");
ObjC.bindFunction("AXUIElementCreateApplication", ["id", ["int"]]);
ObjC.bindFunction("AXUIElementCopyAttributeValue", ["int", ["id", "id", "id *"]]);
ObjC.bindFunction("AXUIElementSetAttributeValue", ["int", ["id", "id", "id"]]);
const CODEX = "com.openai.codex";
const T3 = "com.t3tools.t3code";
const out = $.NSFileHandle.fileHandleWithStandardOutput;
let last = "";
let area;
let areaPid = 0;
let areaWindow;
let manualPid = 0;
function emit(value) {
  const line = JSON.stringify(value);
  if (line === last) return;
  last = line;
  out.writeData($(line + "\n").dataUsingEncoding($.NSUTF8StringEncoding));
}
function copy(element, name) {
  const ref = Ref();
  return $.AXUIElementCopyAttributeValue(element, $(name), ref) === 0 ? ref[0] : undefined;
}
function string(element, name) {
  const value = copy(element, name);
  if (value === undefined || value.isNil()) return undefined;
  if (value.isKindOfClass($.NSURL)) return value.absoluteString.js;
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
function t3Url(pid) {
  const application = $.AXUIElementCreateApplication(pid);
  if (manualPid !== pid) {
    $.AXUIElementSetAttributeValue(application, $("AXManualAccessibility"), $.NSNumber.numberWithBool(true));
    manualPid = pid;
  }
  const window = focusedWindow(application);
  if (window === undefined) return null;
  if (area !== undefined && areaPid === pid && window.isEqual(areaWindow)) {
    const url = string(area, "AXURL");
    if (url && url.startsWith("t3code:")) return url;
  }
  area = findArea(window);
  areaPid = pid;
  areaWindow = window;
  return area === undefined ? null : string(area, "AXURL") || null;
}
function run() {
  const workspace = $.NSWorkspace.sharedWorkspace;
  for (;;) {
    const front = workspace.frontmostApplication;
    const bundle = front.isNil() ? null : front.bundleIdentifier.js;
    const ax = $.AXIsProcessTrusted() === true;
    let url = null;
    if (ax && bundle === T3) url = t3Url(front.processIdentifier);
    const running = [];
    for (const id of [CODEX, T3])
      if ($.NSRunningApplication.runningApplicationsWithBundleIdentifier(id).count > 0) running.push(id);
    emit({ ax, front: bundle, running, t3: url });
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.4));
  }
}
`;
