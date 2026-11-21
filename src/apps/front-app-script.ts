import { AX_HELPERS } from "./ax-helpers";

// JXA program run by /usr/bin/osascript. It prints one JSON line each time the
// frontmost app, the running supported apps, the Accessibility trust, the T3
// Code page URL, or the T3 Code model button changes.
// The cached elements keep each poll to a few AX copies, because JXA does not
// release CF results; FrontAppWatcher also restarts this process periodically.
export const FRONT_APP_SCRIPT = `${AX_HELPERS}
const CODEX = "com.openai.codex";
const out = $.NSFileHandle.fileHandleWithStandardOutput;
const COMPOSER_RETRY = 2;
const THREAD_PAGE = new RegExp("#/(?:threads/)?[^/]+/[^/]+/?$");
let last = "";
let area;
let areaPid = 0;
let areaWindow;
let composer;
let composerUrl;
let composerSearchedAt = 0;
let manualPid = 0;
function emit(value) {
  const line = JSON.stringify(value);
  if (line === last) return;
  last = line;
  out.writeData($(line + "\\n").dataUsingEncoding($.NSUTF8StringEncoding));
}
function t3Page(pid) {
  const application = $.AXUIElementCreateApplication(pid);
  if (manualPid !== pid) {
    $.AXUIElementSetAttributeValue(application, $("AXManualAccessibility"), $.NSNumber.numberWithBool(true));
    manualPid = pid;
  }
  const window = focusedWindow(application);
  if (window === undefined) return { composer: null, url: null };
  let url;
  if (area !== undefined && areaPid === pid && window.isEqual(areaWindow)) {
    url = string(area, "AXURL");
    if (!url || !url.startsWith("t3code:")) url = undefined;
  }
  if (url === undefined) {
    area = findArea(window);
    areaPid = pid;
    areaWindow = window;
    composer = undefined;
    url = area === undefined ? undefined : string(area, "AXURL");
  }
  if (!url) return { composer: null, url: null };
  if (!THREAD_PAGE.test(url)) return { composer: null, url };
  let label = composer === undefined || composerUrl !== url ? undefined : string(composer, "AXDescription");
  if (!label) {
    const now = Date.now() / 1000;
    if (composerUrl !== url || now - composerSearchedAt >= COMPOSER_RETRY) {
      composerSearchedAt = now;
      composerUrl = url;
      composer = findComposer(area);
      label = composer === undefined ? undefined : string(composer, "AXDescription");
    }
  }
  return { composer: label || null, url };
}
function run() {
  const workspace = $.NSWorkspace.sharedWorkspace;
  for (;;) {
    const front = workspace.frontmostApplication;
    const bundle = front.isNil() ? null : front.bundleIdentifier.js;
    const ax = $.AXIsProcessTrusted() === true;
    let page = { composer: null, url: null };
    if (ax && bundle === T3) page = t3Page(front.processIdentifier);
    const running = [];
    for (const id of [CODEX, T3])
      if ($.NSRunningApplication.runningApplicationsWithBundleIdentifier(id).count > 0) running.push(id);
    emit({ ax, composer: page.composer, front: bundle, running, t3: page.url });
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.4));
  }
}
`;
