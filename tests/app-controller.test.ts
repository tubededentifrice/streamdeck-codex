import { describe, expect, it } from "vitest";

import {
  helperExecutablePath,
  settingsLabel,
  updateRemoteTaskThroughApp,
} from "../src/codex/app-controller";

describe("Codex app controller", () => {
  it("builds the combined menu label for current Codex models", () => {
    expect(settingsLabel("gpt-5.6-sol", "medium")).toBe("5.6 Sol Medium");
    expect(settingsLabel("gpt-5.6-luna", "xhigh")).toBe("5.6 Luna Extra High");
    expect(settingsLabel("gpt-5.6-terra", "low")).toBe("5.6 Terra Light");
    expect(settingsLabel("gpt-5.5", "high")).toBe("5.5 High");
    expect(settingsLabel("gpt-5.6-sol", "none")).toBe("5.6 Sol None");
    expect(settingsLabel("gpt-5.6-sol", "minimal")).toBe("5.6 Sol Minimal");
    expect(settingsLabel("gpt-5.6-sol", "max")).toBe("5.6 Sol Max");
    expect(settingsLabel("gpt-5.6-sol", "ultra")).toBe("5.6 Sol Ultra");
  });

  it("resolves the helper beside the built plug-in module", () => {
    expect(helperExecutablePath("file:///plugin/bin/plugin.js")).toBe(
      "/plugin/bin/Codex Controls Helper.app/Contents/MacOS/Codex Controls Helper",
    );
  });

  it("passes exact current and target labels to the helper", async () => {
    const calls: string[][] = [];
    await updateRemoteTaskThroughApp(
      { effort: "medium", model: "gpt-5.6-sol" },
      { effort: "xhigh", model: "gpt-5.6-luna" },
      async (_executable, arguments_) => {
        calls.push(arguments_);
        return {};
      },
    );
    expect(calls).toEqual([
      ["update", "5.6 Sol Medium", "5.6 Luna Extra High"],
    ]);
  });

  it("reports the helper Accessibility permission", async () => {
    await expect(
      updateRemoteTaskThroughApp(
        { effort: "medium", model: "gpt-5.6-sol" },
        { effort: "high", model: "gpt-5.6-sol" },
        async () => {
          throw { stderr: "CODEX_CONTROLS_ERROR:access_denied\n" };
        },
      ),
    ).rejects.toThrow(
      "Allow Codex Controls Helper in macOS Accessibility settings.",
    );
  });

  it("reports the helper Screen Recording permission", async () => {
    await expect(
      updateRemoteTaskThroughApp(
        { effort: "medium", model: "gpt-5.6-sol" },
        { effort: "high", model: "gpt-5.6-sol" },
        async () => {
          throw { stderr: "CODEX_CONTROLS_ERROR:screen_recording_denied\n" };
        },
      ),
    ).rejects.toThrow(
      "Allow Codex Controls Helper in macOS Screen Recording settings.",
    );
  });

  it("does not expose native helper details for an unexpected failure", async () => {
    await expect(
      updateRemoteTaskThroughApp(
        { effort: "medium", model: "gpt-5.6-sol" },
        { effort: "high", model: "gpt-5.6-sol" },
        async () => {
          throw { stderr: "private native failure" };
        },
      ),
    ).rejects.toThrow(
      "Codex did not accept the remote settings through its UI.",
    );
  });
});
