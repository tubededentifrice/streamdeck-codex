import { describe, expect, it } from "vitest";

import { CodexError } from "../src/codex/errors";
import { renderError, renderKey, renderLoading } from "../src/ui/key-renderer";

describe("key renderer", () => {
  it("shows configured labels for the current and next model", () => {
    const image = decodeURIComponent(
      renderKey(
        "model",
        {
          effort: "medium",
          hostId: "local",
          model: "gpt-5.6-sol",
          threadId: "thread-123",
        },
        { label: "Luna", model: "gpt-5.6-luna" },
        2,
        undefined,
        undefined,
        undefined,
        { label: "Sol", model: "gpt-5.6-sol" },
      ),
    );
    expect(image).toContain(">SOL<");
    expect(image).not.toContain("SOL 5.6");
    expect(image).toContain("NEXT  LUNA");
  });

  it("escapes configured labels", () => {
    const image = decodeURIComponent(
      renderKey(
        "model",
        {
          effort: "medium",
          hostId: "local",
          model: "custom",
          threadId: "thread-123",
        },
        { label: "A&B<", model: "next" },
        1,
      ),
    );
    expect(image).toContain("A&amp;B&lt;");
    expect(image).not.toContain("A&B<");
  });

  it("can hide the action title and next value", () => {
    const image = decodeURIComponent(
      renderKey(
        "model",
        {
          effort: "medium",
          hostId: "local",
          model: "gpt-5.6-sol",
          threadId: "thread-123",
        },
        { label: "Luna", model: "gpt-5.6-luna" },
        2,
        undefined,
        undefined,
        { showNext: false, showTitle: false },
        { label: "Sol", model: "gpt-5.6-sol" },
      ),
    );
    expect(image).toContain(">SOL<");
    expect(image).not.toContain(">MODEL<");
    expect(image).not.toContain("NEXT  LUNA");
    expect(image).toMatch(/y="72"[^>]*dominant-baseline="middle"/);
  });

  it("uses only the model label and selected effort for presets", () => {
    const image = decodeURIComponent(
      renderKey(
        "preset",
        {
          effort: "medium",
          hostId: "local",
          model: "gpt-5.6-sol",
          threadId: "thread-123",
        },
        {
          effort: "high",
          label: "Luna",
          model: "gpt-5.6-luna",
        },
        2,
        undefined,
        undefined,
        undefined,
        {
          effort: "medium",
          label: "Sol",
          model: "gpt-5.6-sol",
        },
      ),
    );
    expect(image).toContain(">SOL<");
    expect(image).toContain(">MEDIUM<");
    expect(image).toContain("NEXT  LUNA / HIGH");
    expect(image).not.toContain("SOL 5.6");
  });

  it("uses effort values instead of labels for thinking", () => {
    const image = decodeURIComponent(
      renderKey(
        "thinking",
        {
          effort: "medium",
          hostId: "local",
          model: "gpt-5.6-sol",
          threadId: "thread-123",
        },
        { effort: "high", label: "Ignored next label" },
        2,
        undefined,
        undefined,
        undefined,
        { effort: "medium", label: "Ignored current label" },
      ),
    );
    expect(image).toContain(">MEDIUM<");
    expect(image).toContain("NEXT  HIGH");
    expect(image).not.toContain("IGNORED");
  });

  it("supports larger font sizes and aligns preset values by their size", () => {
    const image = decodeURIComponent(
      renderKey(
        "preset",
        {
          effort: "medium",
          hostId: "local",
          model: "gpt-5.6-sol",
          threadId: "thread-123",
        },
        undefined,
        1,
        undefined,
        undefined,
        { modelFontSize: 48, thinkingFontSize: 10 },
        {
          effort: "medium",
          label: "Sol",
          model: "gpt-5.6-sol",
        },
      ),
    );
    expect(image).toMatch(/y="60"[^>]*font-size="48"[^>]*>SOL<\/text>/);
    expect(image).toMatch(/y="82\.3"[^>]*font-size="10"[^>]*>MEDIUM<\/text>/);

    const reversed = decodeURIComponent(
      renderKey(
        "preset",
        {
          effort: "medium",
          hostId: "local",
          model: "gpt-5.6-sol",
          threadId: "thread-123",
        },
        undefined,
        1,
        undefined,
        undefined,
        { modelFontSize: 10, thinkingFontSize: 48 },
        {
          effort: "medium",
          label: "Sol",
          model: "gpt-5.6-sol",
        },
      ),
    );
    expect(reversed).toMatch(/y="46\.7"[^>]*font-size="10"[^>]*>SOL<\/text>/);
    expect(reversed).toMatch(/y="69"[^>]*font-size="48"[^>]*>MEDIUM<\/text>/);
  });

  it("limits unexpected font sizes to the supported range", () => {
    const image = decodeURIComponent(
      renderKey(
        "model",
        {
          effort: "medium",
          hostId: "local",
          model: "gpt-5.6-sol",
          threadId: "thread-123",
        },
        undefined,
        1,
        undefined,
        undefined,
        { modelFontSize: 100 },
        { label: "Sol", model: "gpt-5.6-sol" },
      ),
    );
    expect(image).toMatch(
      /y="64\.5"[^>]*dominant-baseline="middle"[^>]*font-size="48"/,
    );
  });

  it("shows an inactive chat status on three lines", () => {
    const image = decodeURIComponent(
      renderLoading("model", "NOT IN ACTIVE CHAT"),
    );
    expect(image).toContain(">NOT IN<");
    expect(image).toContain(">ACTIVE<");
    expect(image).toContain(">CHAT<");
    expect(image).not.toContain("TASK LOADING");
  });

  it("can hide the action title from status displays", () => {
    const image = decodeURIComponent(
      renderLoading("model", "NOT IN ACTIVE CHAT", { showTitle: false }),
    );
    expect(image).toContain(">NOT IN<");
    expect(image).not.toContain(">MODEL<");
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
        2,
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
      renderError("preset", new Error("Secret local path /tmp/private")),
    );
    expect(image).toContain("CODEX OFFLINE");
    expect(image).not.toContain("/tmp/private");
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
});
