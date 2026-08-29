import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repositoryRoot = new URL("../", import.meta.url);

describe("release pipeline", () => {
  it("can replace an existing plug-in package", () => {
    const script = readFileSync(
      new URL("scripts/package-plugin.mjs", repositoryRoot),
      "utf8",
    );

    expect(script).toMatch(/"pack"[\s\S]*"--force"/);
  });

  it("checks every required submission image size", () => {
    const script = readFileSync(
      new URL("scripts/generate-publication-assets.mjs", repositoryRoot),
      "utf8",
    );

    expect(script).toContain(
      'verifyDimensions(join(marketplaceDirectory, "icon.png"), 288, 288);',
    );
    expect(script).toContain(
      'verifyDimensions(join(marketplaceDirectory, "thumbnail.png"), 1920, 960);',
    );
    expect(script).toContain('"03-shortcuts.png"');
  });
});
