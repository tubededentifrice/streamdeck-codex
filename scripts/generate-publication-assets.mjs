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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  choicesFor,
  defaultsFor,
  displayChoice,
  nextChoice,
} from "../src/domain/settings.ts";
import { activeStyleFor } from "../src/domain/styles.ts";
import { renderKey } from "../src/ui/key-renderer.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginImages = join(
  root,
  "com.courcelle.codex-controls.sdPlugin",
  "imgs",
  "plugin",
);
const sourceDirectory = join(root, "marketplace", "source");
const imageDirectory = join(root, "marketplace", "images");
const fontCandidates = [
  "/System/Library/Fonts/HelveticaNeue.ttc",
  "/System/Library/Fonts/SFNS.ttf",
];
const font = fontCandidates.find(existsSync);

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
  return match[1];
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

const keys = {
  afterPreset: keyFor("preset", {
    ...state,
    effort: "high",
    model: "gpt-5.6-luna",
  }),
  model: keyFor("model", state),
  preset: keyFor("preset", state),
  thinking: keyFor("thinking", state),
};

function keyAt(kind, x, y, size) {
  const scale = size / 144;
  return `<g transform="translate(${x} ${y}) scale(${scale})">${innerSvg(keys[kind])}</g>`;
}

function imageData(path) {
  return `data:image/png;base64,${readFileSync(path).toString("base64")}`;
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
const hero = shell(
  `<g filter="url(#shadow)">
    ${keyAt("model", 980, 308, 250)}
    ${keyAt("thinking", 1265, 308, 250)}
    ${keyAt("preset", 1550, 308, 250)}
  </g>`,
  `<image href="${logo}" x="112" y="100" width="118" height="118"/>
  <text x="256" y="148" fill="#F7F9FF" font-size="34" font-weight="700">Codex Controls</text>
  <text x="256" y="188" fill="#9BA8BF" font-size="22">for Stream Deck</text>
  <text x="112" y="360" fill="#F7F9FF" font-size="76" font-weight="800">Control Codex</text>
  <text x="112" y="446" fill="#F7F9FF" font-size="76" font-weight="800">from Stream Deck.</text>
  <text x="116" y="526" fill="#BAC5D8" font-size="27">Set a model, set a thinking level,</text>
  <text x="116" y="565" fill="#BAC5D8" font-size="27">or change both with one preset.</text>
  <g transform="translate(112 660)">
    <rect width="650" height="92" rx="24" fill="#FFFFFF" fill-opacity="0.06" stroke="#FFFFFF" stroke-opacity="0.1"/>
    <circle cx="42" cy="46" r="8" fill="#38BDF8"/>
    <text x="68" y="40" fill="#F3F6FC" font-size="20" font-weight="700">Current and next values</text>
    <text x="68" y="67" fill="#9EABC0" font-size="17">See the current value and the next value.</text>
  </g>
  <text x="1100" y="624" fill="#91A0B8" font-size="19" font-weight="700" letter-spacing="2">MODEL</text>
  <text x="1344" y="624" fill="#91A0B8" font-size="19" font-weight="700" letter-spacing="2">THINKING</text>
  <text x="1640" y="624" fill="#91A0B8" font-size="19" font-weight="700" letter-spacing="2">PRESET</text>
  <text x="112" y="866" fill="#74839B" font-size="18">Changes apply to the selected task&apos;s next turn.</text>`,
);

const settings = shell(
  `<g filter="url(#shadow)">
    ${keyAt("preset", 1225, 330, 270)}
    ${keyAt("afterPreset", 1535, 330, 270)}
  </g>`,
  `<text x="100" y="102" fill="#9A8BFF" font-size="20" font-weight="800" letter-spacing="3">DEFAULT DISPLAY SETTINGS</text>
  <text x="100" y="170" fill="#F7F9FF" font-size="55" font-weight="800">Ready on the first key.</text>
  <text x="100" y="218" fill="#A8B4C8" font-size="23">The publication images use the plug-in defaults.</text>
  <g transform="translate(100 274)">
    <rect width="840" height="594" rx="24" fill="#24262B" stroke="#FFFFFF" stroke-opacity="0.12"/>
    <rect width="840" height="62" rx="24" fill="#303238"/>
    <rect y="40" width="840" height="22" fill="#303238"/>
    <circle cx="31" cy="31" r="7" fill="#FF6259"/><circle cx="55" cy="31" r="7" fill="#FFBD2E"/><circle cx="79" cy="31" r="7" fill="#28C941"/>
    <text x="420" y="39" text-anchor="middle" fill="#D9DCE3" font-size="17" font-weight="700">Preset settings</text>
    <text x="28" y="104" fill="#D8DCE4" font-size="17">Add one value to set it. Add more values to cycle.</text>
    <rect x="28" y="130" width="784" height="96" rx="10" fill="#2D2F34" stroke="#555960"/>
    <text x="46" y="157" fill="#C9CDD6" font-size="15">Key display</text>
    <rect x="46" y="176" width="18" height="18" rx="3" fill="#5D7EFF"/><path d="M50 185l4 4 7-9" fill="none" stroke="#fff" stroke-width="2.4"/>
    <text x="74" y="191" fill="#EDF0F6" font-size="15">Show the action title</text>
    <rect x="266" y="176" width="18" height="18" rx="3" fill="#5D7EFF"/><path d="M270 185l4 4 7-9" fill="none" stroke="#fff" stroke-width="2.4"/>
    <text x="294" y="191" fill="#EDF0F6" font-size="15">Show the next value</text>
    <text x="518" y="191" fill="#C9CDD6" font-size="15">Model 21</text>
    <text x="652" y="191" fill="#C9CDD6" font-size="15">Thinking 18</text>
    <g transform="translate(28 250)">
      <rect width="784" height="132" rx="10" fill="#292B30" stroke="#474A50"/>
      <text x="20" y="31" fill="#8E9BB0" font-size="13" font-weight="700" letter-spacing="1">VALUE 1</text>
      <text x="20" y="68" fill="#C9CDD6" font-size="15">Model label</text><rect x="122" y="46" width="226" height="34" rx="5" fill="#1F2024" stroke="#555960"/><text x="138" y="69" fill="#FFF" font-size="15">Sol</text>
      <text x="382" y="68" fill="#C9CDD6" font-size="15">Model</text><rect x="446" y="46" width="310" height="34" rx="5" fill="#1F2024" stroke="#555960"/><text x="462" y="69" fill="#FFF" font-size="15">gpt-5.6-sol</text>
      <text x="20" y="108" fill="#C9CDD6" font-size="15">Thinking</text><rect x="122" y="86" width="226" height="34" rx="5" fill="#1F2024" stroke="#555960"/><text x="138" y="109" fill="#FFF" font-size="15">Medium</text>
      <text x="382" y="108" fill="#C9CDD6" font-size="15">Colors</text><rect x="446" y="86" width="310" height="34" rx="5" fill="#082F49" stroke="#38BDF8"/><text x="462" y="109" fill="#F0F9FF" font-size="15">Ocean</text>
    </g>
    <g transform="translate(28 400)">
      <rect width="784" height="132" rx="10" fill="#292B30" stroke="#474A50"/>
      <text x="20" y="31" fill="#8E9BB0" font-size="13" font-weight="700" letter-spacing="1">VALUE 2</text>
      <text x="20" y="68" fill="#C9CDD6" font-size="15">Model label</text><rect x="122" y="46" width="226" height="34" rx="5" fill="#1F2024" stroke="#555960"/><text x="138" y="69" fill="#FFF" font-size="15">Luna</text>
      <text x="382" y="68" fill="#C9CDD6" font-size="15">Model</text><rect x="446" y="46" width="310" height="34" rx="5" fill="#1F2024" stroke="#555960"/><text x="462" y="69" fill="#FFF" font-size="15">gpt-5.6-luna</text>
      <text x="20" y="108" fill="#C9CDD6" font-size="15">Thinking</text><rect x="122" y="86" width="226" height="34" rx="5" fill="#1F2024" stroke="#555960"/><text x="138" y="109" fill="#FFF" font-size="15">High</text>
      <text x="382" y="108" fill="#C9CDD6" font-size="15">Colors</text><rect x="446" y="86" width="310" height="34" rx="5" fill="#2E1065" stroke="#A78BFA"/><text x="462" y="109" fill="#F5F3FF" font-size="15">Violet</text>
    </g>
  </g>
  <text x="1085" y="257" fill="#F7F9FF" font-size="33" font-weight="800">Current value</text>
  <text x="1490" y="257" fill="#F7F9FF" font-size="33" font-weight="800">After one press</text>
  <path d="M1505 465h22" stroke="#A78BFA" stroke-width="6" stroke-linecap="round"/><path d="m1519 451 15 14-15 14" fill="none" stroke="#A78BFA" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="1090" y="690" fill="#A8B4C8" font-size="21">The key shows Sol and Medium now.</text>
  <text x="1090" y="726" fill="#A8B4C8" font-size="21">The next press selects Luna and High.</text>
  <rect x="1090" y="780" width="665" height="68" rx="18" fill="#FFFFFF" fill-opacity="0.06" stroke="#FFFFFF" stroke-opacity="0.1"/>
  <circle cx="1127" cy="814" r="7" fill="#A78BFA"/>
  <text x="1150" y="821" fill="#D9DEEA" font-size="18">One value sets. Two or more values cycle.</text>`,
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
