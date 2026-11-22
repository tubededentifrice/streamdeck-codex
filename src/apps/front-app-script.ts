import { CHATGPT_ACTION } from "../chatgpt/composer-action";
import { CLAUDE_ACTION } from "../claude/composer-action";
import { COMPOSER_ACTION } from "../t3code/composer-action";
import { AX_HELPERS } from "./ax-helpers";

// JXA program run by /usr/bin/osascript. It prints one JSON line each time the
// frontmost app, the running supported apps, the Accessibility trust, or the
// composer page of the frontmost T3 Code, ChatGPT, or Claude window changes.
// It also runs composer and panel commands that the plug-in writes to
// "<argv[0]>/command.json", and prints each result as a JSON line. The cached
// window and model buttons make a command fast.
// The cached elements keep each poll to a few AX copies, because JXA does not
// release CF results; FrontAppWatcher also restarts this process periodically.
export const FRONT_APP_SCRIPT = `${AX_HELPERS}
${COMPOSER_ACTION}
${CHATGPT_ACTION}
${CLAUDE_ACTION}
const out = $.NSFileHandle.fileHandleWithStandardOutput;
const files = $.NSFileManager.defaultManager;
const COMPOSER_RETRY = 1;
const POLL_INTERVAL = 0.4;
const COMMAND_INTERVAL = 0.05;
const THREAD_PAGE = new RegExp("#/(?:threads/)?[^/]+/[^/]+/?$");
// How each app shows its composers. The route identifies the open thread: the
// T3 Code or Claude page URL, or the ChatGPT window title, because the ChatGPT
// page URL does not change between threads.
const APPS = {
  chatgpt: {
    apply: (app, button, request) => applyChatGPT(app.element, app.pid, button, request),
    isButton: (element) => Boolean(string(element, "AXTitle")) && !string(element, "AXDescription"),
    label: chatgptLabel,
    name: "ChatGPT",
    prefix: "app://",
    route: (window, url) => string(window, "AXTitle") || null,
  },
  claude: {
    apply: (app, button, request) => applyClaude(app.element, button, request),
    isButton: isClaudeButton,
    label: claudeLabel,
    name: "Claude",
    prefix: "https://claude.ai/",
    route: (window, url) => url,
  },
  t3code: {
    apply: (app, button, request) => applyComposer(app.element, button, request),
    isButton: (element) =>
      !string(element, "AXTitle") &&
      children(element).some((child) => string(child, "AXRole") === "AXStaticText"),
    label: (button) => string(button, "AXDescription"),
    name: "T3 Code",
    prefix: "t3code:",
    route: (window, url) => (THREAD_PAGE.test(url) ? url : null),
  },
};
const pages = {};
const manual = {};
let last = "";
function write(value) {
  out.writeData($(JSON.stringify(value) + "\\n").dataUsingEncoding($.NSUTF8StringEncoding));
}
function emit(value) {
  const line = JSON.stringify(value);
  if (line === last) return;
  last = line;
  write(value);
}
// Electron apps build their Accessibility tree only on request.
function enableAccessibility(application, pid) {
  if (manual[pid]) return;
  $.AXUIElementSetAttributeValue(application, $("AXManualAccessibility"), $.NSNumber.numberWithBool(true));
  manual[pid] = true;
}
function pageFor(key) {
  if (!pages[key])
    pages[key] = { active: 0, area: undefined, composers: [], labels: [], pid: 0, route: undefined, searchedAt: 0, window: undefined };
  return pages[key];
}
// Returns the page URL of the focused window, or undefined.
function currentArea(key, application, pid) {
  const page = pageFor(key);
  const prefix = APPS[key].prefix;
  const window = focusedWindow(application);
  if (window === undefined) return undefined;
  if (page.area !== undefined && page.pid === pid && window.isEqual(page.window)) {
    const url = string(page.area, "AXURL");
    if (url && url.startsWith(prefix)) return { url, window };
  }
  page.area = findArea(window, prefix);
  page.pid = pid;
  page.window = window;
  page.composers = [];
  page.labels = [];
  if (page.area === undefined) return undefined;
  const url = string(page.area, "AXURL");
  return url ? { url, window } : undefined;
}
function currentComposers(key, route, force) {
  const page = pageFor(key);
  const app = APPS[key];
  const now = Date.now() / 1000;
  const valid =
    page.composers.length > 0 &&
    page.route === route &&
    page.composers.every((item) => string(item.button, "AXRole") === "AXPopUpButton");
  if (valid && !force) return page.composers;
  if (!force && page.route === route && now - page.searchedAt < COMPOSER_RETRY) return page.composers;
  page.searchedAt = now;
  if (page.route !== route) page.active = 0;
  page.route = route;
  page.composers = findComposers(page.area, app.isButton);
  page.labels = page.composers.map(() => undefined);
  return page.composers;
}
// The keys follow the composer whose message field had the focus last. A
// focused message field that is not known yet is a new composer, such as a
// new side chat, so the composers are searched again.
function followFocus(key, application, route) {
  const page = pageFor(key);
  const focused = copy(application, "AXFocusedUIElement");
  if (focused !== undefined && !focused.isNil()) {
    let index = page.composers.findIndex((item) => focused.isEqual(item.text));
    if (
      index < 0 &&
      Date.now() / 1000 - page.searchedAt >= COMPOSER_RETRY &&
      string(focused, "AXRole") === "AXTextArea"
    ) {
      currentComposers(key, route, true);
      index = page.composers.findIndex((item) => focused.isEqual(item.text));
    }
    if (index >= 0) page.active = index;
  }
  if (page.active >= page.composers.length) page.active = 0;
}
// The label of the active composer. A button can hide its label for a moment,
// such as while its picker is open, so the last label stays until then.
function composerLabel(key) {
  const page = pageFor(key);
  const item = page.composers[page.active];
  if (item === undefined) return null;
  const label = APPS[key].label(item.button);
  if (label) page.labels[page.active] = label;
  return page.labels[page.active] || null;
}
function readPage(key, pid) {
  const application = $.AXUIElementCreateApplication(pid);
  enableAccessibility(application, pid);
  const area = currentArea(key, application, pid);
  if (!area) return { composer: null, index: 0, route: null };
  const route = APPS[key].route(area.window, area.url);
  if (!route) return { composer: null, index: 0, route: key === "t3code" ? area.url : null };
  currentComposers(key, route, false);
  followFocus(key, application, route);
  return { composer: composerLabel(key), index: pageFor(key).active, route };
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
  const key = request.app === "chatgpt" || request.app === "claude" ? request.app : "t3code";
  const name = APPS[key].name;
  try {
    const pid = runningPid(key);
    if (pid === undefined) throw new Error("error:" + name + " is not running.");
    const app = { element: $.AXUIElementCreateApplication(pid), pid };
    enableAccessibility(app.element, app.pid);
    const area = currentArea(key, app.element, app.pid);
    const route = area === undefined ? null : APPS[key].route(area.window, area.url);
    if (!route) throw new Error("error:" + name + " shows no chat.");
    if (request.route && request.route !== route) throw new Error("error:The selected task changed before the update.");
    if (key === "claude" && typeof request.panel === "string") {
      toggleClaudePanel(pageFor(key).area, request.panel);
      write({ result: { id: request.id } });
      return;
    }
    const composers = currentComposers(key, route, true);
    followFocus(key, app.element, route);
    const page = pageFor(key);
    if (composers.length === 0) throw new Error("error:" + name + " shows no model button.");
    if (Number.isInteger(request.composer) && request.composer !== page.active)
      throw new Error("error:The selected task changed before the update.");
    const description = APPS[key].apply(app, composers[page.active].button, request);
    if (description) page.labels[page.active] = description;
    write({ result: { description, id: request.id } });
  } catch (error) {
    const message = String((error && error.message) || error);
    write({
      result: {
        error: message.startsWith("error:") ? message.slice(6) : name + " did not apply the change.",
        id: request.id,
      },
    });
  }
}
function run(argv) {
  const command = argv[0] + "/command.json";
  const workspace = $.NSWorkspace.sharedWorkspace;
  // A plug-in restart can end the plug-in without this process. The process
  // then has a new parent and stops, so that only one watcher runs.
  const parent = $.getppid();
  let polledAt = 0;
  for (;;) {
    if (files.fileExistsAtPath(command)) runCommand(command);
    if (Date.now() - polledAt >= POLL_INTERVAL * 1000) {
      if ($.getppid() !== parent) $.exit(0);
      polledAt = Date.now();
      const front = workspace.frontmostApplication;
      const key = appKey(front);
      const ax = $.AXIsProcessTrusted() === true;
      let page = { composer: null, index: 0, route: null };
      if (ax && APPS[key]) page = readPage(key, front.processIdentifier);
      const running = [];
      for (const candidate of ["codex", "chatgpt", "claude", "t3code"])
        if (runningPid(candidate) !== undefined) running.push(candidate);
      emit({ ax, front: key, page, running });
    }
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(COMMAND_INTERVAL));
  }
}
`;
