import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  choicesFor,
  defaultsFor,
  displayChoice,
  nextChoice,
} from "../src/domain/settings.ts";
import {
  activeStyleFor,
  BUILT_IN_STYLES,
  resolveStyleById,
} from "../src/domain/styles.ts";
import { renderKey, renderShortcutKey } from "../src/ui/key-renderer.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginImages = join(
  root,
  "com.courcelle.codex-controls.sdPlugin",
  "imgs",
  "plugin",
);
const sourceDirectory = join(root, "marketplace", "source");
const imageDirectory = join(root, "marketplace", "images");
const propertyInspectorDirectory = join(
  root,
  "com.courcelle.codex-controls.sdPlugin",
  "ui",
);
const fontCandidates = [
  "/System/Library/Fonts/HelveticaNeue.ttc",
  "/System/Library/Fonts/SFNS.ttf",
];
const font = fontCandidates.find(existsSync);
const browserCandidates = [
  process.env.CODEX_CONTROLS_BROWSER,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
].filter(Boolean);

mkdirSync(sourceDirectory, { recursive: true });
mkdirSync(imageDirectory, { recursive: true });

const state = {
  effort: "medium",
  hostId: "local",
  model: "gpt-5.6-sol",
  threadId: "publication-preview",
};

function decodeSvg(dataUrl) {
  return decodeURIComponent(dataUrl.slice("data:image/svg+xml,".length));
}

function innerSvg(svg) {
  const match = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg);
  if (!match) throw new Error("The key renderer returned invalid SVG.");
  return match[1].replace(/[ \t]+$/gm, "");
}

function keyFor(kind, codexState) {
  const settings = defaultsFor(kind);
  const choices = choicesFor(kind, settings);
  const current = displayChoice(kind, settings, codexState);
  const next = nextChoice(kind, settings, codexState);
  const style = activeStyleFor(kind, settings, codexState);
  return decodeSvg(
    renderKey(
      kind,
      codexState,
      next,
      choices.length,
      style,
      undefined,
      settings,
      current,
    ),
  );
}

function shortcutKey() {
  const settings = defaultsFor("shortcut");
  const choices = choicesFor("shortcut", settings);
  const current = choices[0];
  return decodeSvg(
    renderShortcutKey(
      current,
      undefined,
      choices.length,
      resolveStyleById(current.styleId),
      undefined,
      settings,
    ),
  );
}

const keys = {
  afterPreset: keyFor("preset", {
    ...state,
    effort: "high",
    model: "gpt-5.6-luna",
  }),
  model: keyFor("model", state),
  preset: keyFor("preset", state),
  shortcut: shortcutKey(),
  thinking: keyFor("thinking", state),
};

function keyAt(kind, x, y, size) {
  const scale = size / 144;
  return `<g transform="translate(${x} ${y}) scale(${scale})">${innerSvg(keys[kind])}</g>`;
}

function imageData(path) {
  return `data:image/png;base64,${readFileSync(path).toString("base64")}`;
}

function browserPath() {
  const browser = browserCandidates.find(existsSync);
  if (browser) return browser;
  throw new Error(
    "Install Chrome, Chromium, or Edge, or set CODEX_CONTROLS_BROWSER to a browser executable.",
  );
}

function propertyInspectorPreviewHtml() {
  const sourcePath = join(propertyInspectorDirectory, "action.html");
  const source = readFileSync(sourcePath, "utf8");
  const scriptTag = '    <script src="action.js"></script>';
  if (!source.includes(scriptTag)) {
    throw new Error("The property inspector script tag changed.");
  }

  const baseUrl = pathToFileURL(`${propertyInspectorDirectory}${sep}`).href;
  const actionInfo = JSON.stringify({
    action: "com.courcelle.codex-controls.preset",
    payload: { settings: defaultsFor("preset") },
  });
  const styleCatalog = JSON.stringify({
    builtInStyles: BUILT_IN_STYLES,
    customStyles: [],
    type: "styles/catalog",
  });
  const mock = `    <script>
      class PublicationPreviewSocket {
        static OPEN = 1;
        readyState = PublicationPreviewSocket.OPEN;
        listeners = new Map();

        constructor() {
          queueMicrotask(() => this.emit("open", {}));
        }

        addEventListener(type, listener) {
          const listeners = this.listeners.get(type) || [];
          listeners.push(listener);
          this.listeners.set(type, listeners);
        }

        emit(type, event) {
          for (const listener of this.listeners.get(type) || []) listener(event);
        }

        send(data) {
          const message = JSON.parse(data);
          if (message.payload?.type !== "styles/get") return;
          queueMicrotask(() => {
            this.emit("message", {
              data: JSON.stringify({
                event: "sendToPropertyInspector",
                payload: ${styleCatalog},
              }),
            });
            const renderedStyles = [...document.querySelectorAll(".selected-style-name")]
              .map((element) => element.textContent);
            if (renderedStyles.join(",") !== "Ocean,Violet") return;
            document.documentElement.dataset.publicationPreview = "ready";
            const readyMarker = document.createElement("span");
            readyMarker.style.cssText =
              "background:#01fe02;left:0;height:4px;position:fixed;top:0;width:4px;z-index:2147483647";
            document.body.append(readyMarker);
          });
        }
      }
      window.WebSocket = PublicationPreviewSocket;
    </script>`;
  const connect = `    <script>
      window.connectElgatoStreamDeckSocket(
        "0",
        "publication-preview",
        "registerPropertyInspector",
        "{}",
        ${JSON.stringify(actionInfo)},
      );
    </script>`;

  return source
    .replace("  <head>", `  <head>\n    <base href="${baseUrl}" />`)
    .replace(scriptTag, `${mock}\n${scriptTag}\n${connect}`);
}

function capturePropertyInspector() {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "codex-controls-inspector-"),
  );
  const profile = join(temporaryDirectory, "browser-profile");
  const html = join(temporaryDirectory, "property-inspector.html");
  const screenshot = join(temporaryDirectory, "property-inspector.png");
  const browser = browserPath();
  const url = pathToFileURL(html).href;
  const browserArguments = [
    "--headless=new",
    "--allow-file-access-from-files",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-gpu",
    "--force-device-scale-factor=1",
    "--hide-scrollbars",
    "--no-first-run",
    `--user-data-dir=${profile}`,
    "--window-size=500,720",
  ];

  try {
    writeFileSync(html, propertyInspectorPreviewHtml());
    try {
      execFileSync(
        browser,
        [...browserArguments, `--screenshot=${screenshot}`, url],
        { stdio: "ignore", timeout: 5_000 },
      );
    } catch (error) {
      if (error?.code !== "ETIMEDOUT" || !existsSync(screenshot)) throw error;
    }
    if (!existsSync(screenshot)) {
      throw new Error(
        "The browser did not create the property inspector image.",
      );
    }
    const captureDetails = execFileSync(
      "magick",
      [screenshot, "-format", "%w,%h;%[pixel:p{1,1}]", "info:"],
      { encoding: "utf8" },
    );
    if (
      !captureDetails.startsWith("500,720;") ||
      !captureDetails.includes("1,254,2")
    ) {
      throw new Error("The property inspector preview did not finish.");
    }
    return imageData(screenshot);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function maskPluginLogo() {
  const source = join(pluginImages, "marketplace-source.png");
  const master = join(pluginImages, "marketplace@2x.png");
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "codex-controls-logo-"),
  );
  const masked = join(temporaryDirectory, "marketplace@2x.png");
  execFileSync(
    "magick",
    [
      source,
      "-alpha",
      "on",
      "(",
      "-size",
      "512x512",
      "xc:none",
      "-fill",
      "white",
      "-draw",
      "roundrectangle 0,0 511,511 104,104",
      ")",
      "-compose",
      "DstIn",
      "-composite",
      masked,
    ],
    { stdio: "inherit" },
  );
  copyFileSync(masked, master);
  rmSync(temporaryDirectory, { recursive: true });
  renderPng(master, join(pluginImages, "marketplace.png"), 256, 256);
}

function shell(svg, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="960" viewBox="0 0 1920 960">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1920" y2="960" gradientUnits="userSpaceOnUse">
      <stop stop-color="#070A10"/>
      <stop offset="0.55" stop-color="#101827"/>
      <stop offset="1" stop-color="#20184A"/>
    </linearGradient>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(1460 410) rotate(128) scale(650 750)" gradientUnits="userSpaceOnUse">
      <stop stop-color="#694DFF" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#694DFF" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
      <feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#000" flood-opacity="0.55"/>
    </filter>
  </defs>
  <rect width="1920" height="960" fill="url(#background)"/>
  <rect width="1920" height="960" fill="url(#glow)"/>
  <g font-family="Helvetica Neue,Arial,sans-serif">${body}</g>
  ${svg}
</svg>`;
}

maskPluginLogo();
const logo = imageData(join(pluginImages, "marketplace@2x.png"));
const propertyInspector = capturePropertyInspector();
const hero = shell(
  `<g filter="url(#shadow)">
    ${keyAt("model", 995, 308, 200)}
    ${keyAt("thinking", 1215, 308, 200)}
    ${keyAt("preset", 1435, 308, 200)}
    ${keyAt("shortcut", 1655, 308, 200)}
  </g>`,
  `<image href="${logo}" x="112" y="100" width="118" height="118"/>
  <text x="256" y="148" fill="#F7F9FF" font-size="34" font-weight="700">Codex Controls</text>
  <text x="256" y="188" fill="#9BA8BF" font-size="22">for Stream Deck</text>
  <text x="112" y="360" fill="#F7F9FF" font-size="76" font-weight="800">Control Codex</text>
  <text x="112" y="446" fill="#F7F9FF" font-size="76" font-weight="800">from Stream Deck.</text>
  <text x="116" y="526" fill="#BAC5D8" font-size="27">Set a model, set a thinking level,</text>
  <text x="116" y="565" fill="#BAC5D8" font-size="27">change both, or open a Codex panel.</text>
  <g transform="translate(112 660)">
    <rect width="650" height="92" rx="24" fill="#FFFFFF" fill-opacity="0.06" stroke="#FFFFFF" stroke-opacity="0.1"/>
    <circle cx="42" cy="46" r="8" fill="#38BDF8"/>
    <text x="68" y="40" fill="#F3F6FC" font-size="20" font-weight="700">Current and next values</text>
    <text x="68" y="67" fill="#9EABC0" font-size="17">See the current value and the next value.</text>
  </g>
  <text x="1060" y="574" fill="#91A0B8" font-size="17" font-weight="700" letter-spacing="2">MODEL</text>
  <text x="1258" y="574" fill="#91A0B8" font-size="17" font-weight="700" letter-spacing="2">THINKING</text>
  <text x="1490" y="574" fill="#91A0B8" font-size="17" font-weight="700" letter-spacing="2">PRESET</text>
  <text x="1680" y="574" fill="#91A0B8" font-size="17" font-weight="700" letter-spacing="2">SHORTCUT</text>
  <text x="112" y="866" fill="#74839B" font-size="18">Changes apply to the selected task&apos;s next turn.</text>`,
);

const settings = shell(
  `<g filter="url(#shadow)">
    <rect x="92" y="94" width="556" height="810" rx="25" fill="#202226" stroke="#FFFFFF" stroke-opacity="0.14"/>
    <rect x="92" y="94" width="556" height="54" rx="25" fill="#303238"/>
    <rect x="92" y="124" width="556" height="24" fill="#303238"/>
    <circle cx="122" cy="121" r="7" fill="#FF6259"/>
    <circle cx="146" cy="121" r="7" fill="#FFBD2E"/>
    <circle cx="170" cy="121" r="7" fill="#28C941"/>
    <text x="370" y="128" text-anchor="middle" fill="#D9DCE3" font-size="17" font-weight="700">Preset settings</text>
    <image href="${propertyInspector}" x="106" y="158" width="528" height="720" preserveAspectRatio="none"/>
    <rect x="106" y="158" width="5" height="5" fill="#2D2D2D"/>
    ${keyAt("preset", 1015, 400, 270)}
    ${keyAt("afterPreset", 1425, 400, 270)}
  </g>`,
  `<text x="780" y="118" fill="#9A8BFF" font-size="20" font-weight="800" letter-spacing="3">ACTUAL DEFAULT SETTINGS</text>
  <text x="780" y="190" fill="#F7F9FF" font-size="55" font-weight="800">The real controls.</text>
  <text x="780" y="237" fill="#A8B4C8" font-size="23">Generated from the plug-in property inspector and key renderer.</text>
  <text x="1008" y="348" fill="#F7F9FF" font-size="30" font-weight="800">Current value</text>
  <text x="1410" y="348" fill="#F7F9FF" font-size="30" font-weight="800">After one press</text>
  <path d="M1320 535h38" stroke="#A78BFA" stroke-width="6" stroke-linecap="round"/>
  <path d="m1348 521 15 14-15 14" fill="none" stroke="#A78BFA" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="1000" y="738" fill="#A8B4C8" font-size="21">The key shows Sol and Medium now.</text>
  <text x="1000" y="774" fill="#A8B4C8" font-size="21">The next press selects Luna and High.</text>
  <rect x="1000" y="824" width="700" height="68" rx="18" fill="#FFFFFF" fill-opacity="0.06" stroke="#FFFFFF" stroke-opacity="0.1"/>
  <circle cx="1037" cy="858" r="7" fill="#A78BFA"/>
  <text x="1060" y="865" fill="#D9DEEA" font-size="18">One value sets. Two or more values cycle.</text>`,
);

function writeSvg(name, content) {
  const path = join(sourceDirectory, `${name}.svg`);
  writeFileSync(path, content);
  return path;
}

function renderPng(source, output, width, height) {
  const args = ["-background", "none"];
  if (font) args.push("-font", font);
  args.push(source, "-resize", `${width}x${height}!`, "-depth", "8", output);
  execFileSync("magick", args, { stdio: "inherit" });
}

const heroSource = writeSvg("01-default-controls", hero);
const settingsSource = writeSvg("02-default-settings", settings);
renderPng(
  heroSource,
  join(imageDirectory, "01-default-controls.png"),
  1920,
  960,
);
renderPng(
  settingsSource,
  join(imageDirectory, "02-default-settings.png"),
  1920,
  960,
);
renderPng(
  join(pluginImages, "category-icon-source.svg"),
  join(pluginImages, "category-icon.png"),
  28,
  28,
);
renderPng(
  join(pluginImages, "category-icon-source.svg"),
  join(pluginImages, "category-icon@2x.png"),
  56,
  56,
);
