import { describe, expect, it } from "vitest";

import { CodexError } from "../src/codex/errors";
import type { CodexState } from "../src/domain/settings";
import {
  renderError,
  renderKey,
  renderLoading,
  renderShortcutKey,
  renderSingleKey,
} from "../src/ui/key-renderer";

function state(values: Partial<CodexState> = {}): CodexState {
  return {
    effort: "medium",
    hostId: "local",
    model: "gpt-5.6-sol",
    threadId: "thread-123",
    ...values,
  };
}

/** The text lines of a key image, from top to bottom. */
function textLines(image: string): { size: number; text: string; y: number }[] {
  return [
    ...image.matchAll(
      /<text[^>]* y="([\d.]+)"[^>]*font-size="(\d+)"[^>]*>([^<]*)<\/text>/g,
    ),
  ].map(([, y, size, text]) => ({ size: Number(size), text, y: Number(y) }));
}

describe("key renderer", () => {
  it("renders each shortcut with its selected colors and no footer", () => {
    for (const shortcut of [
      "review",
      "terminal",
      "browser",
      "files",
      "side-chat",
    ] as const) {
      const image = decodeURIComponent(
        renderShortcutKey(
          { label: shortcut, shortcut },
          {
            backgroundColor: "#112233",
            borderColor: "#445566",
            fontColor: "#DDEEFF",
            id: "custom:test",
            name: "Test",
          },
        ),
      );
      expect(image).toContain('fill="#112233"');
      expect(image).toContain('stroke="#445566"');
      expect(image).toContain('fill="#DDEEFF"');
      expect(image).toContain(`>${shortcut.toUpperCase()}<`);
      expect(image).not.toContain("NEXT");
      expect(image).not.toContain("OPEN CODEX");
    }
  });

  it("shows one shortcut as a direct Codex action", () => {
    const image = decodeURIComponent(
      renderShortcutKey(
        { label: "Side chat", shortcut: "side-chat" },
        undefined,
        undefined,
        { fitText: false, showTitle: true },
      ),
    );
    expect(image).toContain(">SIDE CHAT<");
    expect(image).not.toContain("OPEN CODEX");
    expect(image).toMatch(/y="38\.1"[^>]*font-size="15"[^>]*>SHORTCUT<\/text>/);
    expect(image).toContain('<g transform="translate(0 9.95)">');
    expect(image).toMatch(
      /y="116\.73"[^>]*font-size="18"[^>]*>SIDE CHAT<\/text>/,
    );

    const withoutTitle = decodeURIComponent(
      renderShortcutKey(
        { label: "Side chat", shortcut: "side-chat" },
        undefined,
        undefined,
        { fitText: false },
      ),
    );
    expect(withoutTitle).not.toContain(">SHORTCUT<");
    expect(withoutTitle).toContain('<g transform="translate(0 1.7)">');
    expect(withoutTitle).toMatch(
      /y="108\.48"[^>]*font-size="18"[^>]*>SIDE CHAT<\/text>/,
    );
  });

  it("shows configured labels for the current and next model", () => {
    const image = decodeURIComponent(
      renderKey(
        "model",
        state(),
        { label: "Luna", model: "gpt-5.6-luna" },
        undefined,
        undefined,
        undefined,
        { label: "Sol", model: "gpt-5.6-sol" },
      ),
    );
    expect(image).toContain(">SOL<");
    expect(image).not.toContain("SOL 5.6");
    expect(image).toMatch(/font-size="13"[^>]*>LUNA<\/text>/);
    expect(image).not.toContain("NEXT");
    expect(image).not.toContain("<circle");
    expect(image).not.toContain(">MODEL<");
  });

  it("shows a one-value key without a prefix", () => {
    const image = decodeURIComponent(
      renderKey("model", state(), { label: "Luna", model: "gpt-5.6-luna" }),
    );
    expect(image).toContain(">LUNA<");
    expect(image).not.toMatch(/>SET /);
  });

  it("escapes configured labels", () => {
    const image = decodeURIComponent(
      renderKey("model", state({ model: "custom" }), {
        label: "A&B<",
        model: "next",
      }),
    );
    expect(image).toContain("A&amp;B&lt;");
    expect(image).not.toContain("A&B<");
  });

  it("names a model without a configured label from its id", () => {
    const image = decodeURIComponent(
      renderKey("model", state({ model: "claude-opus-5-5" }), {
        label: "Luna",
        model: "gpt-5.6-luna",
      }),
    );
    expect(image).toContain(">OPUS 5.5<");
  });

  it("can hide the next value and show the action title", () => {
    const image = decodeURIComponent(
      renderKey(
        "model",
        state(),
        { label: "Luna", model: "gpt-5.6-luna" },
        undefined,
        undefined,
        { fitText: false, showNext: false, showTitle: false },
        { label: "Sol", model: "gpt-5.6-sol" },
      ),
    );
    expect(image).toContain(">SOL<");
    expect(image).not.toContain(">MODEL<");
    expect(image).not.toContain("LUNA");
    expect(image).toMatch(/y="79\.56"[^>]*font-size="21"/);

    const titled = decodeURIComponent(
      renderKey(
        "model",
        state(),
        undefined,
        undefined,
        undefined,
        { fitText: false, showNext: false, showTitle: true },
        { label: "Sol", model: "gpt-5.6-sol" },
      ),
    );
    expect(titled).toMatch(/y="59\.05"[^>]*>MODEL<\/text>/);
    expect(titled).toMatch(/y="95\.81"[^>]*>SOL<\/text>/);
    expect(titled).not.toContain("<line");
  });

  it("shows the next preset model and thinking level on two lines", () => {
    const image = decodeURIComponent(
      renderKey(
        "preset",
        state(),
        { effort: "high", label: "Luna", model: "gpt-5.6-luna" },
        undefined,
        undefined,
        undefined,
        { effort: "medium", label: "Sol", model: "gpt-5.6-sol" },
      ),
    );
    const lines = textLines(image);
    expect(lines.map((line) => line.text)).toEqual([
      "SOL",
      "MEDIUM",
      "LUNA",
      "HIGH",
    ]);
    expect(lines[2].size).toBe(lines[3].size);
    expect(lines[3].y).toBeGreaterThan(lines[2].y);
    expect(image).not.toContain("SOL 5.6");
  });

  it("uses effort values instead of labels for thinking", () => {
    const image = decodeURIComponent(
      renderKey(
        "thinking",
        state(),
        { effort: "high", label: "Ignored next label" },
        undefined,
        undefined,
        undefined,
        { effort: "medium", label: "Ignored current label" },
      ),
    );
    expect(image).toContain(">MEDIUM<");
    expect(image).toContain(">HIGH<");
    expect(image).not.toContain("IGNORED");
  });

  it("fits each value to the key", () => {
    const short = textLines(
      decodeURIComponent(
        renderKey(
          "model",
          state(),
          { label: "Luna", model: "gpt-5.6-luna" },
          undefined,
          undefined,
          { modelFontSize: 12 },
          { label: "Sol", model: "gpt-5.6-sol" },
        ),
      ),
    );
    const long = textLines(
      decodeURIComponent(
        renderKey(
          "model",
          state(),
          { label: "Luna", model: "gpt-5.6-luna" },
          undefined,
          undefined,
          undefined,
          { label: "Opus 5.5 Extended", model: "gpt-5.6-sol" },
        ),
      ),
    );
    expect(short[0].size).toBe(40);
    expect(long[0].size).toBeLessThan(short[0].size);
    expect(long[0].size).toBeGreaterThanOrEqual(16);
  });

  it("breaks a long unconfigured model name into lines inside the key", () => {
    const image = decodeURIComponent(
      renderKey(
        "model",
        state({ model: "vendor-ultra-reasoning-model-preview-2-1" }),
        { label: "Luna", model: "gpt-5.6-luna" },
      ),
    );
    const lines = textLines(image);
    const value = lines.slice(0, -1);
    expect(value.length).toBeGreaterThan(1);
    expect(value.map((line) => line.text).join(" ")).toBe(
      "VENDOR ULTRA REASONING MODEL PREVIEW 2.1",
    );
    for (const line of lines) {
      expect(line.y - line.size * 0.7).toBeGreaterThan(10);
      expect(line.y).toBeLessThan(134);
    }
  });

  it("keeps a fitted stack with a title inside the key", () => {
    const lines = textLines(
      decodeURIComponent(
        renderKey(
          "preset",
          state(),
          {
            effort: "xhigh",
            label: "Codex Max 5.1",
            model: "gpt-5.1-codex-max",
          },
          undefined,
          undefined,
          { showTitle: true },
          { effort: "medium", label: "Opus 5.5", model: "gpt-5.6-sol" },
        ),
      ),
    );
    expect(lines[0].text).toBe("PRESET");
    expect(lines.at(-1)?.text).toBe("XHIGH");
    expect(lines[0].y - lines[0].size * 0.7).toBeGreaterThan(10);
    expect(lines.at(-1)!.y).toBeLessThan(134);
  });

  it("supports larger font sizes and aligns preset values by their size", () => {
    const image = decodeURIComponent(
      renderKey(
        "preset",
        state(),
        undefined,
        undefined,
        undefined,
        {
          fitText: false,
          modelFontSize: 48,
          showNext: false,
          thinkingFontSize: 10,
        },
        { effort: "medium", label: "Sol", model: "gpt-5.6-sol" },
      ),
    );
    const [sol, medium] = textLines(image);
    expect(sol).toMatchObject({ size: 48, text: "SOL" });
    expect(medium).toMatchObject({ size: 10, text: "MEDIUM" });
    // Centers 48 * 0.35 + 2.5 + 10 * 0.35 apart, with baselines 0.36 × size below.
    expect(medium.y - sol.y).toBeCloseTo(9.12, 2);
  });

  it("limits unexpected font sizes to the supported range", () => {
    const image = decodeURIComponent(
      renderKey(
        "model",
        state(),
        undefined,
        undefined,
        undefined,
        { fitText: false, modelFontSize: 100, showNext: false },
        { label: "Sol", model: "gpt-5.6-sol" },
      ),
    );
    expect(image).toMatch(/y="89\.28"[^>]*font-size="48"/);
  });

  it("shows an inactive chat status on three lines", () => {
    const image = decodeURIComponent(
      renderLoading("model", "NOT IN ACTIVE CHAT", { showTitle: true }),
    );
    expect(image).toContain(">NOT IN<");
    expect(image).toContain(">ACTIVE<");
    expect(image).toContain(">CHAT<");
    expect(image).not.toContain("TASK LOADING");
    expect(image).toMatch(/y="50\.37"[^>]*font-size="17"[^>]*>MODEL<\/text>/);
    expect(image).toMatch(/y="68\.85"[^>]*font-size="15"[^>]*>NOT IN<\/text>/);
    expect(image).toMatch(/y="87\.35"[^>]*font-size="15"[^>]*>ACTIVE<\/text>/);
    expect(image).toMatch(/y="105\.85"[^>]*font-size="15"[^>]*>CHAT<\/text>/);
  });

  it("can hide the action title from status displays", () => {
    const image = decodeURIComponent(
      renderLoading("model", "NOT IN ACTIVE CHAT", { showTitle: false }),
    );
    expect(image).toContain(">NOT IN<");
    expect(image).not.toContain(">MODEL<");
    expect(image).toMatch(/y="58\.9"[^>]*font-size="15"[^>]*>NOT IN<\/text>/);
    expect(image).toMatch(/y="77\.4"[^>]*font-size="15"[^>]*>ACTIVE<\/text>/);
    expect(image).toMatch(/y="95\.9"[^>]*font-size="15"[^>]*>CHAT<\/text>/);
  });

  it("uses a temporary border color for success blinking", () => {
    const image = decodeURIComponent(
      renderKey(
        "thinking",
        {
          effort: "high",
          hostId: "local",
          model: "gpt-5.6-sol",
          threadId: "thread-123",
        },
        { effort: "medium", label: "Medium" },
        {
          backgroundColor: "#112233",
          borderColor: "#445566",
          fontColor: "#DDEEFF",
          id: "custom:test",
          name: "Test",
        },
        "#ffffff",
      ),
    );
    expect(image).toContain('stroke="#ffffff"');
    expect(image).toContain('fill="#112233"');
    expect(image).toContain('fill="#DDEEFF"');
  });

  it("does not expose error details on the key", () => {
    const image = decodeURIComponent(
      renderError(
        "preset",
        new Error("Secret local path /tmp/private"),
        "refresh",
        { showTitle: true },
      ),
    );
    expect(image).toContain("CODEX OFFLINE");
    expect(image).not.toContain("/tmp/private");
    expect(image).toMatch(/y="63\.33"[^>]*font-size="28"[^>]*>!<\/text>/);
    expect(image).toMatch(
      /y="83\.7"[^>]*font-size="15"[^>]*>CODEX OFFLINE<\/text>/,
    );
    expect(image).toMatch(/y="100\.65"[^>]*font-size="10"[^>]*>PRESET<\/text>/);
  });

  it("distinguishes task state and update failures from an offline app", () => {
    expect(
      decodeURIComponent(
        renderError(
          "preset",
          new CodexError("resolving-task", "Resolving private task."),
        ),
      ),
    ).toContain(">NOT IN<");
    expect(
      decodeURIComponent(
        renderError(
          "preset",
          new CodexError("task-state-unavailable", "Private task state."),
        ),
      ),
    ).toContain("TASK UNREADY");
    expect(
      decodeURIComponent(
        renderError("preset", new Error("Remote update failed."), "update"),
      ),
    ).toContain("UPDATE FAILED");
  });

  it.each([
    [
      new CodexError("accessibility", "Private.", { app: "t3code" }),
      "refresh",
      "ALLOW ACCESS",
    ],
    [
      new CodexError("offline", "Private.", { app: "t3code" }),
      "refresh",
      "T3 OFFLINE",
    ],
    [
      new CodexError("offline", "Private.", { app: "claude" }),
      "refresh",
      "CLAUDE OFFLINE",
    ],
    [
      new CodexError("offline", "Private.", { app: "t3code" }),
      "update",
      "T3 OFFLINE",
    ],
  ] as const)("labels the T3 Code %s error", (error, context, label) => {
    const image = decodeURIComponent(renderError("model", error, context));
    expect(image).toContain(label);
    expect(image).not.toContain("Private.");
  });

  it("labels a shortcut that the app does not have", () => {
    expect(
      decodeURIComponent(
        renderError(
          "shortcut",
          new Error("The selected T3 Code shortcut is not available."),
          "update",
        ),
      ),
    ).toContain("UNAVAILABLE");
  });

  it("shows a single preset with a border while it is active", () => {
    const style = {
      backgroundColor: "#204080",
      borderColor: "#445566",
      fontColor: "#FFFFFF",
      id: "custom:test",
      name: "Test",
    };
    const preset = { effort: "high", label: "Luna", model: "gpt-5.6-luna" };
    const active = decodeURIComponent(
      renderSingleKey(preset, true, style, undefined, { showTitle: true }),
    );
    expect(active).toContain('fill="#204080"');
    expect(active).toContain('stroke="#445566"');
    expect(active).toContain('fill="#FFFFFF"');
    expect(active).toContain(">PRESET<");
    expect(active).toContain(">LUNA<");
    expect(active).toContain(">HIGH<");
    expect(active).not.toContain("NEXT");
    expect(active).not.toContain(" SET ");

    const inactive = decodeURIComponent(renderSingleKey(preset, false, style));
    expect(inactive).not.toContain("stroke=");
    expect(inactive).toContain('fill="#081020"');
    expect(inactive).toContain('fill="#404040"');
    expect(inactive).toContain(">LUNA<");
    expect(inactive).toContain(">HIGH<");
  });

  it("fades an inactive single preset by the configured amount", () => {
    const preset = { effort: "high", label: "Luna", model: "gpt-5.6-luna" };
    const render = (inactiveFade: number) =>
      decodeURIComponent(
        renderSingleKey(preset, false, undefined, undefined, {
          inactiveFade,
          showTitle: false,
        }),
      );
    expect(render(0)).toContain('fill="#ffffff"');
    expect(render(50)).toContain('fill="#808080"');
    expect(render(100)).toContain('fill="#000000"');
    expect(render(250)).toContain('fill="#000000"');
    expect(render(-10)).toContain('fill="#ffffff"');
    expect(render(0)).not.toContain(">PRESET<");
  });

  it("blinks the border of a single preset after a press", () => {
    const preset = { effort: "high", label: "Luna", model: "gpt-5.6-luna" };
    expect(
      decodeURIComponent(renderSingleKey(preset, true, undefined, "#ffffff")),
    ).toContain('stroke="#ffffff"');
  });

  it("uses the Preset title for single preset statuses", () => {
    const display = { showTitle: true };
    expect(
      decodeURIComponent(renderLoading("single", undefined, display)),
    ).toContain(">PRESET<");
    expect(
      decodeURIComponent(
        renderError("single", new Error("Offline"), "refresh", display),
      ),
    ).toContain(">PRESET<");
    expect(decodeURIComponent(renderLoading("single"))).not.toContain(
      ">PRESET<",
    );
  });
});
