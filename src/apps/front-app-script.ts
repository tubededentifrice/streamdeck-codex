import { COMPOSER_ACTION } from "../t3code/composer-action";
import { AX_HELPERS } from "./ax-helpers";

// JXA program run by /usr/bin/osascript. It prints one JSON line each time the
// frontmost app, the running supported apps, the Accessibility trust, the T3
// Code page URL, or the T3 Code model button changes.
// It also runs composer commands that the plug-in writes to
// "<argv[0]>/command.json", and prints each result as a JSON line. The cached
// window and model button make a command fast.
// The cached elements keep each poll to a few AX copies, because JXA does not
// release CF results; FrontAppWatcher also restarts this process periodically.
export const FRONT_APP_SCRIPT = `${AX_HELPERS}
${COMPOSER_ACTION}
const CODEX = "com.openai.codex";
const out = $.NSFileHandle.fileHandleWithStandardOutput;
const files = $.NSFileManager.defaultManager;
const COMPOSER_RETRY = 2;
const POLL_INTERVAL = 0.4;
const COMMAND_INTERVAL = 0.05;
const THREAD_PAGE = new RegExp("#/(?:threads/)?[^/]+/[^/]+/?$");
let last = "";
let area;
let areaPid = 0;
let areaWindow;
let composer;
let composerUrl;
let composerSearchedAt = 0;
let manualPid = 0;
function write(value) {
  out.writeData($(JSON.stringify(value) + "\\n").dataUsingEncoding($.NSUTF8StringEncoding));
}
function emit(value) {
  const line = JSON.stringify(value);
  if (line === last) return;
  last = line;
  write(value);
}
function enableAccessibility(application, pid) {
  if (manualPid === pid) return;
  $.AXUIElementSetAttributeValue(application, $("AXManualAccessibility"), $.NSNumber.numberWithBool(true));
  manualPid = pid;
}
function currentArea(application, pid) {
  const window = focusedWindow(application);
  if (window === undefined) return undefined;
  if (area !== undefined && areaPid === pid && window.isEqual(areaWindow)) {
    const url = string(area, "AXURL");
    if (url && url.startsWith("t3code:")) return url;
  }
  area = findArea(window);
  areaPid = pid;
  areaWindow = window;
  composer = undefined;
  return area === undefined ? undefined : string(area, "AXURL");
}
function currentComposer(url, force) {
  if (composer !== undefined && composerUrl === url && string(composer, "AXDescription")) return composer;
  const now = Date.now() / 1000;
  if (!force && composerUrl === url && now - composerSearchedAt < COMPOSER_RETRY) return undefined;
  composerSearchedAt = now;
  composerUrl = url;
  composer = findComposer(area);
  return composer;
}
function t3Page(pid) {
  const application = $.AXUIElementCreateApplication(pid);
  enableAccessibility(application, pid);
  const url = currentArea(application, pid);
  if (!url) return { composer: null, url: null };
  if (!THREAD_PAGE.test(url)) return { composer: null, url };
  const button = currentComposer(url, false);
  const label = button === undefined ? undefined : string(button, "AXDescription");
  return { composer: label || null, url };
}
function runCommand(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  files.removeItemAtPathError(path, null);
  if (text.isNil()) return;
  let request;
  try {
    request = JSON.parse(text.js);
  } catch (error) {
    return;
  }
  try {
    const t3 = t3Application();
    if (t3 === undefined) throw new Error("error:T3 Code is not running.");
    enableAccessibility(t3.element, t3.pid);
    const url = currentArea(t3.element, t3.pid);
    if (!url || !THREAD_PAGE.test(url)) throw new Error("error:T3 Code shows no thread.");
    if (request.url && request.url !== url) throw new Error("error:The selected task changed before the update.");
    const button = currentComposer(url, true);
    if (button === undefined) throw new Error("error:T3 Code shows no model button.");
    write({ result: { description: applyComposer(t3.element, button, request), id: request.id } });
  } catch (error) {
    const message = String((error && error.message) || error);
    write({
      result: {
        error: message.startsWith("error:") ? message.slice(6) : "T3 Code did not apply the change.",
        id: request.id,
      },
    });
  }
}
function run(argv) {
  const command = argv[0] + "/command.json";
  const workspace = $.NSWorkspace.sharedWorkspace;
  let polledAt = 0;
  for (;;) {
    if (files.fileExistsAtPath(command)) runCommand(command);
    if (Date.now() - polledAt >= POLL_INTERVAL * 1000) {
      polledAt = Date.now();
      const front = workspace.frontmostApplication;
      const bundle = front.isNil() ? null : front.bundleIdentifier.js;
      const ax = $.AXIsProcessTrusted() === true;
      let page = { composer: null, url: null };
      if (ax && bundle === T3) page = t3Page(front.processIdentifier);
      const running = [];
      for (const id of [CODEX, T3])
        if ($.NSRunningApplication.runningApplicationsWithBundleIdentifier(id).count > 0) running.push(id);
      emit({ ax, composer: page.composer, front: bundle, running, t3: page.url });
    }
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(COMMAND_INTERVAL));
  }
}
`;
