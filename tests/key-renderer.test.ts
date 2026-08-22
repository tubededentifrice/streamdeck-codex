import { describe, expect, it } from "vitest";

import { renderError, renderKey } from "../src/ui/key-renderer";

describe("key renderer", () => {
  it("shows the current and next model", () => {
    const image = decodeURIComponent(
      renderKey(
        "model",
        { effort: "medium", model: "gpt-5.6-sol", threadId: "thread-123" },
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
        { effort: "medium", model: "custom", threadId: "thread-123" },
        { label: "A&B<", model: "next" },
        1,
      ),
    );
    expect(image).toContain("A&amp;B&lt;");
    expect(image).not.toContain("A&B<");
  });

  it("does not expose error details on the key", () => {
    const image = decodeURIComponent(
      renderError("preset", new Error("Secret local path /tmp/private")),
    );
    expect(image).toContain("CODEX OFFLINE");
    expect(image).not.toContain("/tmp/private");
  });
});
