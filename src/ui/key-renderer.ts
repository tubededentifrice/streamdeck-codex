import { modelLabel } from "../domain/model-label";
import {
  type ActionKind,
  type CodexState,
  DEFAULT_INACTIVE_FADE,
  type ModelChoice,
  type PresetChoice,
  type SettingsActionKind,
  type ShortcutChoice,
  type ShortcutId,
  type ThinkingChoice,
} from "../domain/settings";
import type { KeyStyle } from "../domain/styles";

type DisplayOptions = {
  fitText?: boolean;
  modelFontSize?: number;
  showNext?: boolean;
  showTitle?: boolean;
  thinkingFontSize?: number;
};

const COLORS: Record<ActionKind, string> = {
  model: "#2f80ed",
  preset: "#7b61ff",
  shortcut: "#34d399",
  single: "#a78bfa",
  thinking: "#f2994a",
};

function titleOf(kind: ActionKind): string {
  return kind === "single" ? "PRESET" : kind.toUpperCase();
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
        "<": "&lt;",
        ">": "&gt;",
      })[character] ?? character,
  );
}

function dataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Omit `accent` to draw the key without a border. */
function svg(
  body: string,
  accent: string | undefined,
  background = "#101319",
): string {
  const border = accent
    ? `<rect x="5" y="5" width="134" height="134" rx="15" fill="none" stroke="${accent}" stroke-width="5"/>`
    : "";
  return dataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
		<rect width="144" height="144" rx="18" fill="${background}"/>
		${border}
		${body}
	</svg>`);
}

/** Mixes a #RRGGBB color toward black, as the unlit key around it. */
function fadeColor(color: string, fade: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match || fade === 0) return color;
  const value = Number.parseInt(match[1], 16);
  const keep = 1 - fade / 100;
  return `#${[16, 8, 0]
    .map((shift) =>
      Math.round(((value >> shift) & 0xff) * keep)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// Advance widths of the bold key font, in 1/1000 em. Stream Deck draws text at
// these widths.
const GLYPH_WIDTHS = new Map<string, number>(
  (
    [
      [" .,/iIjl·", 278],
      [":;!()[]-ft`", 333],
      ["r*{}", 389],
      ['"', 474],
      ["z", 500],
      ["0123456789#$_Jacekvsxy", 556],
      ["+<=>~^", 584],
      ["?FLTZbdghnopqu", 611],
      ["EPSVXY", 667],
      ["ABCDHKNRU&", 722],
      ["GOQw", 778],
      ["M", 833],
      ["%m", 889],
      ["W", 944],
      ["@…", 1000],
      ["'", 238],
      ["|", 280],
    ] as const
  ).flatMap(([characters, width]) =>
    [...characters].map((character) => [character, width] as const),
  ),
);
// The text box is 1 unit inside the inner edge of the 5-unit border.
const BOX_TOP = 8.5;
const BOX_BOTTOM = 135.5;
// The title and the next value are 2 units from the border, so antialiasing
// does not touch the border.
const TITLE_TOP = 9.5;
const NEXT_BOTTOM = 134.5;
const BOX_WIDTH = 127;
const CAP_HEIGHT = 0.72;
const SECTION_GAP = 5;
const TITLE_SIZE = 15;
const NEXT_SIZE = 20;
const MIN_FIT_SIZE = 8;
// The thinking line of a preset is at most this part of the model size.
const SECONDARY_RATIO = 0.8;

function emWidth(text: string): number {
  let width = 0;
  for (const character of text)
    width +=
      GLYPH_WIDTHS.get(character) ??
      ((character.codePointAt(0) ?? 0) >= 0x2e80 ? 1000 : 667);
  return width / 1000;
}

/** The largest size from `min` to `max` at which `text` fits the box width. */
function fitSize(text: string, max: number, min = MIN_FIT_SIZE): number {
  const width = emWidth(text);
  if (width === 0) return max;
  return Math.max(min, Math.min(max, Math.floor(BOX_WIDTH / width)));
}

/** Shortens `text` with an ellipsis until it fits the box width at `size`. */
function clip(text: string, size: number): string {
  if (emWidth(text) * size <= BOX_WIDTH) return text;
  const characters = [...text];
  while (
    characters.length > 1 &&
    emWidth(`${characters.join("")}…`) * size > BOX_WIDTH
  )
    characters.pop();
  return `${characters.join("").trimEnd()}…`;
}

/** The largest size, without limits, at which all lines fit the key width. */
function widthLimit(lines: string[]): number {
  return Math.min(
    ...lines.map((line) => {
      const width = emWidth(line);
      return width === 0 ? Number.POSITIVE_INFINITY : BOX_WIDTH / width;
    }),
  );
}

/** Every way to break `words` into `count` lines, in order. */
function breaks(words: string[], count: number): string[][] {
  if (count === 1) return [[words.join(" ")]];
  const result: string[][] = [];
  for (let index = 1; index <= words.length - count + 1; index += 1)
    for (const rest of breaks(words.slice(index), count - 1))
      result.push([words.slice(0, index).join(" "), ...rest]);
  return result;
}

type Line = {
  dim?: boolean;
  size: number;
  spacing?: number;
  text: string;
  weight: 700 | 800;
};

function lineGap(a: number, b: number): number {
  return Math.min(5, Math.max(2.5, Math.min(a, b) * 0.12));
}

function stackHeight(lines: Line[]): number {
  return lines.reduce(
    (height, line, index) =>
      height +
      line.size * CAP_HEIGHT +
      (index > 0 ? lineGap(lines[index - 1].size, line.size) : 0),
    0,
  );
}

/** Draws `lines` from `top`, which is the cap top of the first line. */
function drawLines(lines: Line[], top: number, font: string): string {
  return lines
    .map((line, index) => {
      if (index > 0) top += lineGap(lines[index - 1].size, line.size);
      top += line.size * CAP_HEIGHT;
      const spacing = line.spacing ? ` letter-spacing="${line.spacing}"` : "";
      const dim = line.dim ? ' fill-opacity="0.8"' : "";
      return `<text x="72" y="${Number(top.toFixed(2))}" text-anchor="middle" fill="${font}"${dim} font-family="-apple-system,Arial,sans-serif" font-size="${line.size}" font-weight="${line.weight}"${spacing}>${escapeXml(line.text)}</text>`;
    })
    .join("\n\t\t");
}

/**
 * Fits the value lines into `height` and the box width, as large as possible.
 * A long value with spaces breaks into up to `maxLines` lines when one line
 * would be small, if each added line makes the text clearly larger. A
 * thinking line is at most 80% of the model size.
 */
function fitValue(
  primary: string,
  secondary: string | undefined,
  height: number,
  maxLines: number,
): Line[] {
  const linesFor = (lines: string[], size: number): Line[] => {
    const result: Line[] = lines.map((text) => ({ size, text, weight: 800 }));
    if (secondary !== undefined)
      result.push({
        size: Math.max(
          MIN_FIT_SIZE,
          Math.floor(Math.min(widthLimit([secondary]), size * SECONDARY_RATIO)),
        ),
        text: secondary,
        weight: 700,
      });
    return result;
  };
  const largest = (lines: string[]): number => {
    let size = Math.floor(
      Math.min(widthLimit(lines), height / (CAP_HEIGHT * lines.length)),
    );
    while (size > MIN_FIT_SIZE && stackHeight(linesFor(lines, size)) > height)
      size -= 1;
    return Math.max(MIN_FIT_SIZE, size);
  };
  let best = { lines: [primary], size: largest([primary]) };
  const words = primary.split(" ").filter(Boolean);
  if (best.size < 18)
    for (let count = 2; count <= Math.min(maxLines, words.length); count += 1) {
      // At the same size, the most even lines have the narrowest widest line.
      const candidates = breaks(words, count).map((lines) => ({
        lines,
        size: largest(lines),
        width: widthLimit(lines),
      }));
      const option = candidates.reduce((a, b) =>
        b.size > a.size || (b.size === a.size && b.width > a.width) ? b : a,
      );
      if (option.size > best.size * 1.3) best = option;
    }
  return linesFor(best.lines, best.size).map((line) => ({
    ...line,
    text: clip(line.text, line.size),
  }));
}

/**
 * Draws the title at the top, the next value at the bottom, and the value in
 * the middle. `value` receives the height that it can use.
 */
function drawKey(
  title: string | undefined,
  value: (height: number) => Line[],
  next: string[],
  font: string,
): string {
  let top = title === undefined ? BOX_TOP : TITLE_TOP;
  let bottom = next.length > 0 ? NEXT_BOTTOM : BOX_BOTTOM;
  const markup: string[] = [];
  if (title !== undefined) {
    const lines: Line[] = [
      {
        size: fitSize(title, TITLE_SIZE),
        spacing: 1.5,
        text: title,
        weight: 800,
      },
    ];
    markup.push(drawLines(lines, top, font));
    top += stackHeight(lines) + SECTION_GAP;
  }
  if (next.length > 0) {
    const size = Math.min(...next.map((text) => fitSize(text, NEXT_SIZE)));
    const lines: Line[] = next.map((text) => ({
      dim: true,
      size,
      text: clip(text, size),
      weight: 700,
    }));
    const height = stackHeight(lines);
    markup.push(drawLines(lines, bottom - height, font));
    bottom -= height + SECTION_GAP;
  }
  const lines = value(bottom - top);
  markup.push(
    drawLines(lines, top + (bottom - top - stackHeight(lines)) / 2, font),
  );
  return markup.join("\n\t\t");
}

/** The value lines at the configured sizes, or fitted to the key. */
function valueLines(
  primary: string,
  secondary: string | undefined,
  primarySize: number,
  secondarySize: number,
  fit: boolean,
): (height: number) => Line[] {
  if (fit)
    return (height) =>
      fitValue(primary, secondary, height, secondary === undefined ? 3 : 2);
  return () => [
    { size: primarySize, text: primary.slice(0, 18), weight: 800 },
    ...(secondary === undefined
      ? []
      : [
          {
            size: secondarySize,
            text: secondary.slice(0, 18),
            weight: 700 as const,
          },
        ]),
  ];
}

function currentLines(
  kind: SettingsActionKind,
  state: CodexState,
  choice: ModelChoice | ThinkingChoice | PresetChoice | undefined,
): [string, string?] {
  const model = (choice as ModelChoice | PresetChoice | undefined)?.label;
  const label = (model ?? modelLabel(state.model)).toUpperCase();
  if (kind === "model") return [label];
  if (kind === "thinking") return [state.effort.toUpperCase()];
  return [label, state.effort.toUpperCase()];
}

function nextLines(
  kind: SettingsActionKind,
  choice: ModelChoice | ThinkingChoice | PresetChoice | undefined,
): string[] {
  if (!choice) return ["NO CHOICES"];
  if (kind === "preset") {
    const preset = choice as PresetChoice;
    return [preset.label.toUpperCase(), preset.effort.toUpperCase()];
  }
  if (kind === "thinking")
    return [(choice as ThinkingChoice).effort.toUpperCase()];
  return [(choice as ModelChoice).label.toUpperCase()];
}

function fadePercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    return DEFAULT_INACTIVE_FADE;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function fontSize(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(10, Math.min(48, Math.round(value)));
}

function alphabeticBaseline(center: number, size: number): number {
  return Number((center + size * 0.36).toFixed(2));
}

function stackCenters(sizes: number[], gap: number): number[] {
  const heights = sizes.map((size) => size * 0.7);
  const totalHeight =
    heights.reduce((total, height) => total + height, 0) +
    Math.max(0, sizes.length - 1) * gap;
  let top = 72 - totalHeight / 2;
  return heights.map((height) => {
    const center = top + height / 2;
    top += height + gap;
    return Number(center.toFixed(2));
  });
}

/** Shows the current value and, at the bottom, the value of the next press. */
export function renderKey(
  kind: SettingsActionKind,
  state: CodexState,
  next: ModelChoice | ThinkingChoice | PresetChoice | undefined,
  style?: KeyStyle,
  borderColor?: string,
  display: DisplayOptions = {},
  current?: ModelChoice | ThinkingChoice | PresetChoice,
): string {
  const [primary, secondary] = currentLines(kind, state, current);
  const accent = style?.borderColor ?? COLORS[kind];
  return svg(
    drawKey(
      display.showTitle === true ? titleOf(kind) : undefined,
      valueLines(
        primary,
        secondary,
        kind === "thinking"
          ? fontSize(display.thinkingFontSize, 21)
          : fontSize(display.modelFontSize, 21),
        fontSize(display.thinkingFontSize, 18),
        display.fitText !== false,
      ),
      display.showNext !== false ? nextLines(kind, next) : [],
      style?.fontColor ?? "#ffffff",
    ),
    borderColor ?? accent,
    style?.backgroundColor,
  );
}

/**
 * A single preset key always shows its own preset. While the task uses other
 * values, the key fades by `inactiveFade` percent and has no border.
 */
export function renderSingleKey(
  preset: PresetChoice,
  active: boolean,
  style?: KeyStyle,
  borderColor?: string,
  display: DisplayOptions & { inactiveFade?: number } = {},
): string {
  const fade = active ? 0 : fadePercent(display.inactiveFade);
  return svg(
    drawKey(
      display.showTitle === true ? titleOf("single") : undefined,
      valueLines(
        preset.label.toUpperCase(),
        preset.effort.toUpperCase(),
        fontSize(display.modelFontSize, 21),
        fontSize(display.thinkingFontSize, 18),
        display.fitText !== false,
      ),
      [],
      fadeColor(style?.fontColor ?? "#ffffff", fade),
    ),
    active ? (borderColor ?? style?.borderColor ?? COLORS.single) : borderColor,
    fadeColor(style?.backgroundColor ?? "#101319", fade),
  );
}

function shortcutIcon(
  shortcut: ShortcutId,
  color: string,
  background: string,
): string {
  if (shortcut === "terminal")
    return `<polygon points="47,47 66,62 47,77 47,69 57,62 47,55" fill="${color}"/><rect x="67" y="74" width="28" height="6" rx="3" fill="${color}"/>`;
  if (shortcut === "browser")
    return `<circle cx="72" cy="62" r="26" fill="${color}"/><circle cx="72" cy="62" r="20" fill="${background}"/><ellipse cx="72" cy="62" rx="10" ry="23" fill="${color}"/><ellipse cx="72" cy="62" rx="6" ry="20" fill="${background}"/><rect x="47" y="60" width="50" height="4" fill="${color}"/>`;
  if (shortcut === "files")
    return `<polygon points="40,48 65,48 72,55 104,55 104,87 40,87" fill="${color}"/><rect x="46" y="62" width="52" height="19" rx="2" fill="${background}"/>`;
  if (shortcut === "side-chat")
    return `<polygon points="40,43 89,43 89,75 60,75 46,86 46,75 40,75" fill="${color}"/><polygon points="70,57 104,57 104,83 91,83 79,92 79,83 70,83" fill="${color}"/><rect x="75" y="62" width="24" height="16" rx="2" fill="${background}"/>`;
  return `<rect x="41" y="46" width="29" height="35" rx="3" fill="${color}"/><rect x="74" y="46" width="29" height="35" rx="3" fill="${color}"/><rect x="47" y="54" width="17" height="4" rx="2" fill="${background}"/><rect x="47" y="63" width="12" height="4" rx="2" fill="${background}"/><rect x="80" y="54" width="17" height="4" rx="2" fill="${background}"/><rect x="80" y="63" width="12" height="4" rx="2" fill="${background}"/>`;
}

export function renderShortcutKey(
  current: ShortcutChoice,
  style?: KeyStyle,
  borderColor?: string,
  display: DisplayOptions & { shortcutFontSize?: number } = {},
): string {
  const showTitle = display.showTitle === true;
  const accent = style?.borderColor ?? COLORS.shortcut;
  const font = style?.fontColor ?? "#ffffff";
  const background = style?.backgroundColor ?? "#101319";
  const fit = display.fitText !== false;
  const text = current.label.toUpperCase();
  const labelSize = fit
    ? fitSize(text, 22)
    : fontSize(display.shortcutFontSize, 18);
  const label = fit ? clip(text, labelSize) : text.slice(0, 18);
  const titleHeight = 15 * 0.7;
  const iconHeight = 56;
  const labelHeight = labelSize * 0.7;
  const totalHeight =
    iconHeight + labelHeight + 4 + (showTitle ? titleHeight + 6 : 0);
  let top = 72 - totalHeight / 2;
  const headerCenter = showTitle ? top + titleHeight / 2 : undefined;
  if (showTitle) top += titleHeight + 6;
  const iconCenter = top + iconHeight / 2;
  top += iconHeight + 4;
  const labelCenter = top + labelHeight / 2;
  const headerMarkup = showTitle
    ? `<text x="72" y="${alphabeticBaseline(headerCenter!, 15)}" text-anchor="middle" fill="${font}" font-family="-apple-system,Arial,sans-serif" font-size="15" font-weight="800" letter-spacing="1.2">SHORTCUT</text>`
    : "";
  return svg(
    `
		${headerMarkup}
		<g transform="translate(0 ${Number((iconCenter - 62).toFixed(2))})">${shortcutIcon(current.shortcut, font, background)}</g>
		<text x="72" y="${alphabeticBaseline(labelCenter, labelSize)}" text-anchor="middle" fill="${font}" font-family="-apple-system,Arial,sans-serif" font-size="${labelSize}" font-weight="800">${escapeXml(label)}</text>
	`,
    borderColor ?? accent,
    style?.backgroundColor,
  );
}

export function renderLoading(
  kind: ActionKind,
  status = "UPDATING…",
  display: DisplayOptions = {},
): string {
  const showTitle = display.showTitle === true;
  const inactive = status === "NOT IN ACTIVE CHAT";
  const statusLines = inactive ? ["NOT IN", "ACTIVE", "CHAT"] : [status];
  const statusSize = inactive ? 15 : 14;
  const sizes = [
    ...(showTitle ? [17] : []),
    ...statusLines.map(() => statusSize),
  ];
  const centers = stackCenters(sizes, inactive ? 8 : 12);
  let centerIndex = 0;
  const header = showTitle
    ? `<text x="72" y="${alphabeticBaseline(centers[centerIndex++], 17)}" text-anchor="middle" fill="#ffffff" font-family="-apple-system,Arial,sans-serif" font-size="17" font-weight="800">${titleOf(kind)}</text>`
    : "";
  const statusMarkup = statusLines
    .map(
      (line) =>
        `<text x="72" y="${alphabeticBaseline(centers[centerIndex++], statusSize)}" text-anchor="middle" fill="#b7c0cf" font-family="-apple-system,Arial,sans-serif" font-size="${statusSize}"${inactive ? ' font-weight="700"' : ""}>${escapeXml(line)}</text>`,
    )
    .join("");
  return svg(
    `
		${header}
		${statusMarkup}
	`,
    COLORS[kind],
  );
}

export function renderError(
  kind: ActionKind,
  error: unknown,
  context: "refresh" | "update" = "refresh",
  display: DisplayOptions = {},
): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  if (code === "resolving-task")
    return renderLoading(kind, "NOT IN ACTIVE CHAT", display);

  const short =
    code === "accessibility"
      ? "ALLOW ACCESS"
      : code === "select-task" || message.includes("Select a task")
        ? "SELECT CHAT"
        : code === "task-state-unavailable"
          ? "CHAT UNREADY"
          : kind === "shortcut" && message.includes("not available")
            ? "UNAVAILABLE"
            : message.includes("choice") ||
                (kind === "shortcut" && message.includes("shortcut"))
              ? "CHECK SETTINGS"
              : context === "update" && code !== "offline"
                ? kind === "shortcut"
                  ? "OPEN FAILED"
                  : "UPDATE FAILED"
                : "APP OFFLINE";
  const showKind = display.showTitle === true;
  const centers = stackCenters(showKind ? [28, 15, 10] : [28, 15], 10);
  const kindMarkup = showKind
    ? `<text x="72" y="${alphabeticBaseline(centers[2], 10)}" text-anchor="middle" fill="#aab2bf" font-family="-apple-system,Arial,sans-serif" font-size="10">${escapeXml(titleOf(kind))}</text>`
    : "";
  return svg(
    `
		<text x="72" y="${alphabeticBaseline(centers[0], 28)}" text-anchor="middle" fill="#ff5c6c" font-family="-apple-system,Arial,sans-serif" font-size="28" font-weight="900">!</text>
		<text x="72" y="${alphabeticBaseline(centers[1], 15)}" text-anchor="middle" fill="#ffffff" font-family="-apple-system,Arial,sans-serif" font-size="15" font-weight="800">${escapeXml(short)}</text>
		${kindMarkup}
	`,
    "#d64555",
  );
}
