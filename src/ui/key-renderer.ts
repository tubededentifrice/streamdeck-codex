import type {
  ActionKind,
  CodexState,
  ModelChoice,
  PresetChoice,
  ThinkingChoice,
} from "../domain/settings";
import type { KeyStyle } from "../domain/styles";

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

function currentLines(kind: ActionKind, state: CodexState): [string, string?] {
  if (kind === "model") return [compactModel(state.model)];
  if (kind === "thinking") return [state.effort.toUpperCase()];
  return [compactModel(state.model), state.effort.toUpperCase()];
}

function nextLabel(
  kind: ActionKind,
  choice: ModelChoice | ThinkingChoice | PresetChoice | undefined,
): string | undefined {
  if (!choice) return undefined;
  if (kind === "preset") {
    const preset = choice as PresetChoice;
    return `${compactModel(preset.model)} / ${preset.effort.toUpperCase()}`;
  }
  return choice.label.toUpperCase();
}

export function renderKey(
  kind: ActionKind,
  state: CodexState,
  next: ModelChoice | ThinkingChoice | PresetChoice | undefined,
  choiceCount: number,
  style?: KeyStyle,
  borderColor?: string,
): string {
  const [primary, secondary] = currentLines(kind, state);
  const target = nextLabel(kind, next);
  const header = kind.toUpperCase();
  const primaryY = secondary ? 51 : 62;
  const accent = style?.borderColor ?? COLORS[kind];
  const font = style?.fontColor ?? "#ffffff";
  const secondaryMarkup = secondary
    ? `<text x="72" y="77" text-anchor="middle" fill="${font}" font-size="18" font-weight="700">${escapeXml(secondary)}</text>`
    : "";
  const footer = target
    ? `${choiceCount > 1 ? "NEXT" : "SET"}  ${target}`
    : "NO CHOICES";
  return svg(
    `
		<text x="72" y="26" text-anchor="middle" fill="${font}" font-family="-apple-system,Arial,sans-serif" font-size="15" font-weight="800" letter-spacing="1.5">${header}</text>
		<text x="72" y="${primaryY}" text-anchor="middle" fill="${font}" font-family="-apple-system,Arial,sans-serif" font-size="21" font-weight="800">${escapeXml(primary)}</text>
		${secondaryMarkup}
		<line x1="20" y1="94" x2="124" y2="94" stroke="${accent}" stroke-width="2" opacity="0.55"/>
		<text x="72" y="118" text-anchor="middle" fill="${font}" font-family="-apple-system,Arial,sans-serif" font-size="11" font-weight="700">${escapeXml(footer.slice(0, 28))}</text>
		<circle cx="72" cy="130" r="3" fill="${accent}"/>
	`,
    borderColor ?? accent,
    style?.backgroundColor,
  );
}

export function renderLoading(kind: ActionKind, status = "UPDATING…"): string {
  return svg(
    `
		<text x="72" y="62" text-anchor="middle" fill="#ffffff" font-family="-apple-system,Arial,sans-serif" font-size="17" font-weight="800">${kind.toUpperCase()}</text>
		<text x="72" y="91" text-anchor="middle" fill="#b7c0cf" font-family="-apple-system,Arial,sans-serif" font-size="14">${escapeXml(status)}</text>
	`,
    COLORS[kind],
  );
}

export function renderError(
  kind: ActionKind,
  error: unknown,
  context: "refresh" | "update" = "refresh",
): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  const short =
    code === "select-task" || message.includes("Select a task")
      ? "SELECT TASK"
      : code === "resolving-task"
        ? "TASK LOADING"
        : code === "task-state-unavailable"
          ? "TASK UNREADY"
          : message.includes("choice")
            ? "CHECK SETTINGS"
            : context === "update"
              ? "UPDATE FAILED"
              : "CODEX OFFLINE";
  return svg(
    `
		<text x="72" y="52" text-anchor="middle" fill="#ff5c6c" font-family="-apple-system,Arial,sans-serif" font-size="28" font-weight="900">!</text>
		<text x="72" y="82" text-anchor="middle" fill="#ffffff" font-family="-apple-system,Arial,sans-serif" font-size="15" font-weight="800">${escapeXml(short)}</text>
		<text x="72" y="107" text-anchor="middle" fill="#aab2bf" font-family="-apple-system,Arial,sans-serif" font-size="10">${escapeXml(kind.toUpperCase())}</text>
	`,
    "#d64555",
  );
}
