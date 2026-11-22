import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const uiDirectory = new URL(
  "../com.courcelle.codex-controls.sdPlugin/ui/",
  import.meta.url,
);

describe("property inspector visibility", () => {
  it("hides the add button for the single-value actions", () => {
    const script = readFileSync(new URL("action.js", uiDirectory), "utf8");
    const styles = readFileSync(new URL("action.css", uiDirectory), "utf8");

    expect(script).toContain(
      'const singleValue = () => kind === "shortcut" || kind === "single";',
    );
    expect(script).toContain(
      'document.querySelector(".add-row").hidden = singleValue();',
    );
    expect(styles).toMatch(/\[hidden\]\s*{\s*display:\s*none\s*!important;/);
  });
});
