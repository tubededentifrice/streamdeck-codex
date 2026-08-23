import { describe, expect, it } from "vitest";

import { CodexError } from "../src/codex/errors";
import { renderError, renderKey, renderLoading } from "../src/ui/key-renderer";

describe("key renderer", () => {
  it("shows the current and next model", () => {
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
      ),
    );
    expect(image).toContain("SOL 5.6");
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
      ),
    );
    expect(image).toContain("SOL 5.6");
    expect(image).not.toContain(">MODEL<");
    expect(image).not.toContain("NEXT  LUNA");
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
