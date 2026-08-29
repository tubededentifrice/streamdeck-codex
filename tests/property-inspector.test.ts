import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const uiDirectory = new URL(
  "../com.courcelle.codex-controls.sdPlugin/ui/",
  import.meta.url,
);

describe("property inspector visibility", () => {
  it("hides the add button for the single-value Shortcut action", () => {
    const script = readFileSync(new URL("action.js", uiDirectory), "utf8");
    const styles = readFileSync(new URL("action.css", uiDirectory), "utf8");

    expect(script).toContain(
      'document.querySelector("#add").hidden = kind === "shortcut";',
    );
    expect(styles).toMatch(/\[hidden\]\s*{\s*display:\s*none\s*!important;/);
  });
});
