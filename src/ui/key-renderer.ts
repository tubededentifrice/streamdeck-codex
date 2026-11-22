import type {
  ActionKind,
  CodexState,
  ModelChoice,
  PresetChoice,
  SettingsActionKind,
  ShortcutChoice,
  ShortcutId,
  ThinkingChoice,
} from "../domain/settings";
import type { KeyStyle } from "../domain/styles";

type DisplayOptions = {
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

function compactModel(model: string): string {
  const match = /^gpt-([0-9.]+)-(.+)$/.exec(model);
  if (!match) return model.toUpperCase().slice(0, 18);
  return `${match[2].toUpperCase()} ${match[1]}`.slice(0, 18);
}

function currentLines(
  kind: SettingsActionKind,
  state: CodexState,
  choice: ModelChoice | ThinkingChoice | PresetChoice | undefined,
): [string, string?] {
  if (kind === "model")
    return [
      choice
        ? (choice as ModelChoice).label.toUpperCase()
        : compactModel(state.model),
    ];
  if (kind === "thinking") return [state.effort.toUpperCase()];
  return [
    choice
      ? (choice as PresetChoice).label.toUpperCase()
      : compactModel(state.model),
    state.effort.toUpperCase(),
  ];
}

function nextLabel(
  kind: SettingsActionKind,
  choice: ModelChoice | ThinkingChoice | PresetChoice | undefined,
): string | undefined {
  if (!choice) return undefined;
  if (kind === "preset") {
    const preset = choice as PresetChoice;
    return `${preset.label.toUpperCase()} / ${preset.effort.toUpperCase()}`;
  }
  if (kind === "thinking")
    return (choice as ThinkingChoice).effort.toUpperCase();
  return (choice as ModelChoice).label.toUpperCase();
}

// Same default as DEFAULT_INACTIVE_FADE in settings.ts. This module keeps no
// runtime imports, because the publication script loads it with Node type
// stripping, which cannot resolve extensionless imports.
function fadePercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 75;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function fontSize(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(10, Math.min(48, Math.round(value)));
}

type KeyLayout = {
  footerTop?: number;
  headerCenter?: number;
  primaryCenter: number;
  secondaryCenter?: number;
};

function keyLayout(
  showTitle: boolean,
  showNext: boolean,
  primaryFontSize: number,
  secondaryFontSize?: number,
): KeyLayout {
  const titleHeight = 15 * 0.7;
  const primaryHeight = primaryFontSize * 0.7;
  const secondaryHeight =
    secondaryFontSize === undefined ? 0 : secondaryFontSize * 0.7;
  const valueGap =
    secondaryFontSize === undefined
      ? 0
      : Math.min(
          4,
          Math.max(2, Math.min(primaryFontSize, secondaryFontSize) * 0.12),
        );
  const valueHeight = primaryHeight + valueGap + secondaryHeight;
  const footerHeight = 30;
  const sectionCount = 1 + Number(showTitle) + Number(showNext);
  const fixedHeight =
    valueHeight + (showTitle ? titleHeight : 0) + (showNext ? footerHeight : 0);
  const sectionGap =
    sectionCount === 1
      ? 0
      : Math.max(4, Math.min(22, (128 - fixedHeight) / (sectionCount - 1)));
  const totalHeight = fixedHeight + (sectionCount - 1) * sectionGap;
  let top = 72 - totalHeight / 2;
  let headerCenter: number | undefined;
  if (showTitle) {
    headerCenter = top + titleHeight / 2;
    top += titleHeight + sectionGap;
  }
  const primaryCenter = top + primaryHeight / 2;
  const secondaryCenter =
    secondaryFontSize === undefined
      ? undefined
      : top + primaryHeight + valueGap + secondaryHeight / 2;
  top += valueHeight;
  const footerTop = showNext ? top + sectionGap : undefined;
  return {
    footerTop:
      footerTop === undefined ? undefined : Number(footerTop.toFixed(2)),
    headerCenter:
      headerCenter === undefined ? undefined : Number(headerCenter.toFixed(2)),
    primaryCenter: Number(primaryCenter.toFixed(2)),
    secondaryCenter:
      secondaryCenter === undefined
        ? undefined
        : Number(secondaryCenter.toFixed(2)),
  };
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

export function renderKey(
  kind: SettingsActionKind,
  state: CodexState,
  next: ModelChoice | ThinkingChoice | PresetChoice | undefined,
  choiceCount: number,
  style?: KeyStyle,
  borderColor?: string,
  display: DisplayOptions = {},
  current?: ModelChoice | ThinkingChoice | PresetChoice,
): string {
  const [primary, secondary] = currentLines(kind, state, current);
  const target = nextLabel(kind, next);
  const header = titleOf(kind);
  const showTitle = display.showTitle !== false;
  const showNext = display.showNext !== false;
  const accent = style?.borderColor ?? COLORS[kind];
  const font = style?.fontColor ?? "#ffffff";
  const primaryFontSize =
    kind === "thinking"
      ? fontSize(display.thinkingFontSize, 21)
      : fontSize(display.modelFontSize, 21);
  const secondaryFontSize = fontSize(display.thinkingFontSize, 18);
  const layout = keyLayout(
    showTitle,
    showNext,
    primaryFontSize,
    secondary ? secondaryFontSize : undefined,
  );
  const primaryY = alphabeticBaseline(layout.primaryCenter, primaryFontSize);
  const secondaryY =
    layout.secondaryCenter === undefined
      ? undefined
      : alphabeticBaseline(layout.secondaryCenter, secondaryFontSize);
  const secondaryMarkup = secondary
    ? `<text x="72" y="${secondaryY}" text-anchor="middle" fill="${font}" font-family="-apple-system,Arial,sans-serif" font-size="${secondaryFontSize}" font-weight="700">${escapeXml(secondary)}</text>`
    : "";
  const footer = target
    ? `${choiceCount > 1 ? "NEXT" : "SET"}  ${target}`
    : "NO CHOICES";
  const headerMarkup = showTitle
    ? `<text x="72" y="${alphabeticBaseline(layout.headerCenter!, 15)}" text-anchor="middle" fill="${font}" font-family="-apple-system,Arial,sans-serif" font-size="15" font-weight="800" letter-spacing="1.5">${header}</text>`
    : "";
  const footerMarkup = showNext
    ? `<line x1="20" y1="${layout.footerTop! + 1}" x2="124" y2="${layout.footerTop! + 1}" stroke="${accent}" stroke-width="2" opacity="0.55"/>
		<text x="72" y="${alphabeticBaseline(layout.footerTop! + 15, 11)}" text-anchor="middle" fill="${font}" font-family="-apple-system,Arial,sans-serif" font-size="11" font-weight="700">${escapeXml(footer.slice(0, 28))}</text>
		<circle cx="72" cy="${layout.footerTop! + 27}" r="3" fill="${accent}"/>`
    : "";
  return svg(
    `
		${headerMarkup}
		<text x="72" y="${primaryY}" text-anchor="middle" fill="${font}" font-family="-apple-system,Arial,sans-serif" font-size="${primaryFontSize}" font-weight="800">${escapeXml(primary)}</text>
		${secondaryMarkup}
		${footerMarkup}
	`,
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
  const showTitle = display.showTitle !== false;
  const font = fadeColor(style?.fontColor ?? "#ffffff", fade);
  const background = fadeColor(style?.backgroundColor ?? "#101319", fade);
  const primaryFontSize = fontSize(display.modelFontSize, 21);
  const secondaryFontSize = fontSize(display.thinkingFontSize, 18);
  const layout = keyLayout(
    showTitle,
    false,
    primaryFontSize,
    secondaryFontSize,
  );
  const headerMarkup = showTitle
    ? `<text x="72" y="${alphabeticBaseline(layout.headerCenter!, 15)}" text-anchor="middle" fill="${font}" font-family="-apple-system,Arial,sans-serif" font-size="15" font-weight="800" letter-spacing="1.5">${titleOf("single")}</text>`
    : "";
  return svg(
    `
		${headerMarkup}
		<text x="72" y="${alphabeticBaseline(layout.primaryCenter, primaryFontSize)}" text-anchor="middle" fill="${font}" font-family="-apple-system,Arial,sans-serif" font-size="${primaryFontSize}" font-weight="800">${escapeXml(preset.label.toUpperCase())}</text>
		<text x="72" y="${alphabeticBaseline(layout.secondaryCenter!, secondaryFontSize)}" text-anchor="middle" fill="${font}" font-family="-apple-system,Arial,sans-serif" font-size="${secondaryFontSize}" font-weight="700">${escapeXml(preset.effort.toUpperCase())}</text>
	`,
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
  const showTitle = display.showTitle !== false;
  const accent = style?.borderColor ?? COLORS.shortcut;
  const font = style?.fontColor ?? "#ffffff";
  const background = style?.backgroundColor ?? "#101319";
  const labelSize = fontSize(display.shortcutFontSize, 18);
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
		<text x="72" y="${alphabeticBaseline(labelCenter, labelSize)}" text-anchor="middle" fill="${font}" font-family="-apple-system,Arial,sans-serif" font-size="${labelSize}" font-weight="800">${escapeXml(current.label.toUpperCase().slice(0, 18))}</text>
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
  const showTitle = display.showTitle !== false;
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
                    : "CODEX OFFLINE";
  const showKind = display.showTitle !== false;
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
