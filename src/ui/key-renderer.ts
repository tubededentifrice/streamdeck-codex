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

// Advance widths of a bold sans-serif face, in 1/1000 em. The key font can be
// heavier than this face, so `emWidth` adds a margin.
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
// The text area inside the border, with a margin.
const TEXT_WIDTH = 110;
const TEXT_HEIGHT = 112;
const MIN_SECTION_GAP = 5;
// The height that a wrapped value can use.
const VALUE_HEIGHT = 72;
const DIVIDER_SPACE = 9;
const TITLE_SIZE = 15;
const MIN_FIT_SIZE = 8;

function emWidth(text: string): number {
  let width = 0;
  for (const character of text)
    width +=
      GLYPH_WIDTHS.get(character) ??
      ((character.codePointAt(0) ?? 0) >= 0x2e80 ? 1000 : 667);
  return (width / 1000) * 1.06;
}

/** The largest size from `min` to `max` at which `text` fits the key width. */
function fitSize(text: string, max: number, min = MIN_FIT_SIZE): number {
  const width = emWidth(text);
  if (width === 0) return max;
  return Math.max(min, Math.min(max, Math.floor(TEXT_WIDTH / width)));
}

/** Shortens `text` with an ellipsis until it fits the key width at `size`. */
function clip(text: string, size: number): string {
  if (emWidth(text) * size <= TEXT_WIDTH) return text;
  const characters = [...text];
  while (
    characters.length > 1 &&
    emWidth(`${characters.join("")}…`) * size > TEXT_WIDTH
  )
    characters.pop();
  return `${characters.join("").trimEnd()}…`;
}

/** The largest size, without limits, at which all lines fit the key width. */
function widthLimit(lines: string[]): number {
  return Math.min(
    ...lines.map((line) => {
      const width = emWidth(line);
      return width === 0 ? Number.POSITIVE_INFINITY : TEXT_WIDTH / width;
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

/**
 * Fits a value to the key width. A long value with spaces breaks into up to
 * `maxLines` lines when one line would be smaller than `wrapBelow`. Each added
 * line must make the text clearly larger.
 */
function fitLines(
  text: string,
  max: number,
  wrapBelow: number,
  maxLines: number,
): { lines: string[]; size: number } {
  const sizeOf = (lines: string[]) =>
    Math.min(
      max,
      widthLimit(lines),
      (VALUE_HEIGHT - (lines.length - 1) * 3) / (lines.length * 0.7),
    );
  let best = { lines: [text], size: sizeOf([text]) };
  if (best.size < wrapBelow) {
    const words = text.split(" ").filter(Boolean);
    for (let count = 2; count <= Math.min(maxLines, words.length); count += 1)
      for (const lines of breaks(words, count)) {
        const size = sizeOf(lines);
        if (size > best.size * 1.3) best = { lines, size };
      }
  }
  return {
    lines: best.lines,
    size: Math.max(MIN_FIT_SIZE, Math.floor(best.size)),
  };
}

type Line = {
  dim?: boolean;
  /** The size changes when the stack is too tall for the key. */
  scalable?: boolean;
  size: number;
  spacing?: number;
  text: string;
  weight: 700 | 800;
};
type Section = { divider?: boolean; lines: Line[] };

function lineGap(a: number, b: number): number {
  return Math.min(5, Math.max(2.5, Math.min(a, b) * 0.14));
}

function sectionHeight(section: Section): number {
  return section.lines.reduce(
    (height, line, index) =>
      height +
      line.size * 0.7 +
      (index > 0 ? lineGap(section.lines[index - 1].size, line.size) : 0),
    section.divider ? DIVIDER_SPACE : 0,
  );
}

/** Makes the scalable lines smaller until the stack fits the key height. */
function fitHeight(sections: Section[]): void {
  const minimumGaps = Math.max(0, sections.length - 1) * MIN_SECTION_GAP;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const total = sections.reduce(
      (height, section) => height + sectionHeight(section),
      minimumGaps,
    );
    if (total <= TEXT_HEIGHT) return;
    const scalable = sections
      .flatMap((section) => section.lines)
      .filter((line) => line.scalable);
    const scalableHeight = scalable.reduce(
      (height, line) => height + line.size * 0.7,
      0,
    );
    if (scalableHeight === 0) return;
    const ratio = Math.max(0, 1 - (total - TEXT_HEIGHT) / scalableHeight);
    for (const line of scalable)
      line.size = Math.max(MIN_FIT_SIZE, Math.floor(line.size * ratio));
  }
}

function drawSections(
  sections: Section[],
  font: string,
  accent: string,
): string {
  const heights = sections.map(sectionHeight);
  const fixed = heights.reduce((total, height) => total + height, 0);
  const gap =
    sections.length < 2
      ? 0
      : Math.max(
          MIN_SECTION_GAP,
          Math.min(22, (TEXT_HEIGHT + 4 - fixed) / (sections.length - 1)),
        );
  let top = 72 - (fixed + gap * Math.max(0, sections.length - 1)) / 2;
  const markup: string[] = [];
  for (const section of sections) {
    if (section.divider) {
      const y = Number((top + 1).toFixed(2));
      markup.push(
        `<line x1="20" y1="${y}" x2="124" y2="${y}" stroke="${accent}" stroke-width="2" opacity="0.55"/>`,
      );
      top += DIVIDER_SPACE;
    }
    section.lines.forEach((line, index) => {
      if (index > 0) top += lineGap(section.lines[index - 1].size, line.size);
      const height = line.size * 0.7;
      const spacing = line.spacing ? ` letter-spacing="${line.spacing}"` : "";
      const dim = line.dim ? ' fill-opacity="0.8"' : "";
      markup.push(
        `<text x="72" y="${alphabeticBaseline(top + height / 2, line.size)}" text-anchor="middle" fill="${font}"${dim} font-family="-apple-system,Arial,sans-serif" font-size="${line.size}" font-weight="${line.weight}"${spacing}>${escapeXml(line.text)}</text>`,
      );
      top += height;
    });
    top += gap;
  }
  return markup.join("\n\t\t");
}

function titleSection(kind: ActionKind): Section {
  return {
    lines: [
      { size: TITLE_SIZE, spacing: 1.5, text: titleOf(kind), weight: 800 },
    ],
  };
}

/**
 * The value lines of a key. With `fitText`, each line takes the largest size
 * that fits the key; otherwise it takes its configured size.
 */
function valueSection(
  primary: string,
  secondary: string | undefined,
  primarySize: number,
  secondarySize: number,
  fit: boolean,
): Section {
  if (!fit)
    return {
      lines: [
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
      ],
    };
  const main = fitLines(
    primary,
    secondary === undefined ? 40 : 34,
    16,
    secondary === undefined ? 3 : 2,
  );
  const lines: Line[] = main.lines.map((text) => ({
    scalable: true,
    size: main.size,
    text,
    weight: 800,
  }));
  if (secondary !== undefined)
    lines.push({
      scalable: true,
      size: Math.min(fitSize(secondary, 30), main.size),
      text: secondary,
      weight: 700,
    });
  return { lines };
}

/** The next value below a divider, with the model and thinking on two lines. */
function nextSection(texts: string[], fit: boolean): Section {
  const size = fit ? Math.min(...texts.map((text) => fitSize(text, 13))) : 13;
  return {
    divider: true,
    lines: texts.map((text) => ({
      dim: true,
      size,
      text: fit ? clip(text, size) : text.slice(0, 28),
      weight: 700,
    })),
  };
}

function clipSections(sections: Section[], fit: boolean): void {
  if (!fit) return;
  for (const line of sections.flatMap((section) => section.lines))
    line.text = clip(line.text, line.size);
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

/** Shows the current value and, below a divider, the value of the next press. */
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
  const fit = display.fitText !== false;
  const accent = style?.borderColor ?? COLORS[kind];
  const font = style?.fontColor ?? "#ffffff";
  const sections = [
    ...(display.showTitle === true ? [titleSection(kind)] : []),
    valueSection(
      primary,
      secondary,
      kind === "thinking"
        ? fontSize(display.thinkingFontSize, 21)
        : fontSize(display.modelFontSize, 21),
      fontSize(display.thinkingFontSize, 18),
      fit,
    ),
    ...(display.showNext !== false
      ? [nextSection(nextLines(kind, next), fit)]
      : []),
  ];
  if (fit) fitHeight(sections);
  clipSections(sections, fit);
  return svg(
    drawSections(sections, font, accent),
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
  const fit = display.fitText !== false;
  const font = fadeColor(style?.fontColor ?? "#ffffff", fade);
  const background = fadeColor(style?.backgroundColor ?? "#101319", fade);
  const sections = [
    ...(display.showTitle === true ? [titleSection("single")] : []),
    valueSection(
      preset.label.toUpperCase(),
      preset.effort.toUpperCase(),
      fontSize(display.modelFontSize, 21),
      fontSize(display.thinkingFontSize, 18),
      fit,
    ),
  ];
  if (fit) fitHeight(sections);
  clipSections(sections, fit);
  return svg(
    drawSections(sections, font, style?.borderColor ?? COLORS.single),
    active ? (borderColor ?? style?.borderColor ?? COLORS.single) : borderColor,
    background,
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

  const app =
    error && typeof error === "object" && "app" in error
      ? error.app
      : undefined;
  const short =
    code === "accessibility"
      ? "ALLOW ACCESS"
      : code === "select-task" || message.includes("Select a task")
        ? "SELECT TASK"
        : code === "task-state-unavailable"
          ? "TASK UNREADY"
          : kind === "shortcut" && message.includes("not available")
            ? "UNAVAILABLE"
            : message.includes("choice") ||
                (kind === "shortcut" && message.includes("shortcut"))
              ? "CHECK SETTINGS"
              : context === "update" && code !== "offline"
                ? kind === "shortcut"
                  ? "OPEN FAILED"
                  : "UPDATE FAILED"
                : app === "t3code"
                  ? "T3 OFFLINE"
                  : app === "chatgpt"
                    ? "CHATGPT OFFLINE"
                    : app === "claude"
                      ? "CLAUDE OFFLINE"
                      : "CODEX OFFLINE";
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
