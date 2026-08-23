import type {
  ActionKind,
  CodexState,
  ModelChoice,
  PresetChoice,
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
  thinking: "#f2994a",
};

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

function svg(body: string, accent: string, background = "#101319"): string {
  return dataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
		<rect width="144" height="144" rx="18" fill="${background}"/>
		<rect x="5" y="5" width="134" height="134" rx="15" fill="none" stroke="${accent}" stroke-width="5"/>
		${body}
	</svg>`);
}

function compactModel(model: string): string {
  const match = /^gpt-([0-9.]+)-(.+)$/.exec(model);
  if (!match) return model.toUpperCase().slice(0, 18);
  return `${match[2].toUpperCase()} ${match[1]}`.slice(0, 18);
}

function currentLines(
  kind: ActionKind,
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
  kind: ActionKind,
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

function fontSize(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(10, Math.min(48, Math.round(value)));
}

function valuePositions(
  showTitle: boolean,
  showNext: boolean,
  primaryFontSize: number,
  secondaryFontSize?: number,
): [number, number?] {
  const top = showTitle ? 29 : 10;
  const bottom = showNext ? 100 : 134;
  const center = (top + bottom) / 2;
  if (secondaryFontSize === undefined) return [center];

  const primaryHeight = primaryFontSize * 0.7;
  const secondaryHeight = secondaryFontSize * 0.7;
  const gap = Math.min(
    4,
    Math.max(2, Math.min(primaryFontSize, secondaryFontSize) * 0.12),
  );
  const totalHeight = primaryHeight + gap + secondaryHeight;
  const blockTop = center - totalHeight / 2;
  return [
    Number((blockTop + primaryHeight / 2).toFixed(2)),
    Number((blockTop + primaryHeight + gap + secondaryHeight / 2).toFixed(2)),
  ];
}

export function renderKey(
  kind: ActionKind,
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
  const header = kind.toUpperCase();
  const showTitle = display.showTitle !== false;
  const showNext = display.showNext !== false;
  const accent = style?.borderColor ?? COLORS[kind];
  const font = style?.fontColor ?? "#ffffff";
  const primaryFontSize =
    kind === "thinking"
      ? fontSize(display.thinkingFontSize, 21)
      : fontSize(display.modelFontSize, 21);
  const secondaryFontSize = fontSize(display.thinkingFontSize, 18);
  const [primaryY, secondaryY] = valuePositions(
    showTitle,
    showNext,
    primaryFontSize,
    secondary ? secondaryFontSize : undefined,
  );
  const secondaryMarkup = secondary
    ? `<text x="72" y="${secondaryY}" dominant-baseline="central" text-anchor="middle" fill="${font}" font-family="-apple-system,Arial,sans-serif" font-size="${secondaryFontSize}" font-weight="700">${escapeXml(secondary)}</text>`
    : "";
  const footer = target
    ? `${choiceCount > 1 ? "NEXT" : "SET"}  ${target}`
    : "NO CHOICES";
  const headerMarkup = showTitle
    ? `<text x="72" y="20" dominant-baseline="middle" text-anchor="middle" fill="${font}" font-family="-apple-system,Arial,sans-serif" font-size="15" font-weight="800" letter-spacing="1.5">${header}</text>`
    : "";
  const footerMarkup = showNext
    ? `<line x1="20" y1="102" x2="124" y2="102" stroke="${accent}" stroke-width="2" opacity="0.55"/>
		<text x="72" y="121" dominant-baseline="middle" text-anchor="middle" fill="${font}" font-family="-apple-system,Arial,sans-serif" font-size="11" font-weight="700">${escapeXml(footer.slice(0, 28))}</text>
		<circle cx="72" cy="133" r="3" fill="${accent}"/>`
    : "";
  return svg(
    `
		${headerMarkup}
		<text x="72" y="${primaryY}" dominant-baseline="central" text-anchor="middle" fill="${font}" font-family="-apple-system,Arial,sans-serif" font-size="${primaryFontSize}" font-weight="800">${escapeXml(primary)}</text>
		${secondaryMarkup}
		${footerMarkup}
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
  const header = showTitle
    ? `<text x="72" y="${status === "NOT IN ACTIVE CHAT" ? 28 : 62}" text-anchor="middle" fill="#ffffff" font-family="-apple-system,Arial,sans-serif" font-size="17" font-weight="800">${kind.toUpperCase()}</text>`
    : "";
  const statusMarkup =
    status === "NOT IN ACTIVE CHAT"
      ? ["NOT IN", "ACTIVE", "CHAT"]
          .map(
            (line, index) =>
              `<text x="72" y="${(showTitle ? 55 : 43) + index * 24}" text-anchor="middle" fill="#b7c0cf" font-family="-apple-system,Arial,sans-serif" font-size="15" font-weight="700">${line}</text>`,
          )
          .join("")
      : `<text x="72" y="${showTitle ? 91 : 78}" text-anchor="middle" fill="#b7c0cf" font-family="-apple-system,Arial,sans-serif" font-size="14">${escapeXml(status)}</text>`;
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
    code === "select-task" || message.includes("Select a task")
      ? "SELECT TASK"
      : code === "task-state-unavailable"
        ? "TASK UNREADY"
        : message.includes("choice")
          ? "CHECK SETTINGS"
          : context === "update"
            ? "UPDATE FAILED"
            : "CODEX OFFLINE";
  const kindMarkup =
    display.showTitle !== false
      ? `<text x="72" y="107" text-anchor="middle" fill="#aab2bf" font-family="-apple-system,Arial,sans-serif" font-size="10">${escapeXml(kind.toUpperCase())}</text>`
      : "";
  return svg(
    `
		<text x="72" y="52" text-anchor="middle" fill="#ff5c6c" font-family="-apple-system,Arial,sans-serif" font-size="28" font-weight="900">!</text>
		<text x="72" y="82" text-anchor="middle" fill="#ffffff" font-family="-apple-system,Arial,sans-serif" font-size="15" font-weight="800">${escapeXml(short)}</text>
		${kindMarkup}
	`,
    "#d64555",
  );
}
