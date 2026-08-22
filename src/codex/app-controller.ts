import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { CodexState } from "../domain/settings";

const execFileAsync = promisify(execFile);
const HELPER_ERROR_PREFIX = "CODEX_CONTROLS_ERROR:";

type HelperExecutor = (
  executable: string,
  arguments_: string[],
) => Promise<{ stderr?: string; stdout?: string }>;

function titleCase(value: string): string {
  return value.length === 0
    ? value
    : `${value[0].toUpperCase()}${value.slice(1)}`;
}

function modelLabel(model: string): string {
  const match = /^gpt-([0-9.]+)(?:-(.+))?$/.exec(model);
  if (!match) return model;
  const variant = match[2]?.split("-").map(titleCase).join(" ");
  return variant ? `${match[1]} ${variant}` : match[1];
}

function effortLabel(effort: string): string {
  if (effort === "low") return "Light";
  if (effort === "xhigh") return "Extra High";
  return titleCase(effort);
}

export function settingsLabel(model: string, effort: string): string {
  return `${modelLabel(model)} ${effortLabel(effort)}`;
}

export function helperExecutablePath(moduleUrl = import.meta.url): string {
  return path.join(
    path.dirname(fileURLToPath(moduleUrl)),
    "Codex Controls Helper.app",
    "Contents",
    "MacOS",
    "Codex Controls Helper",
  );
}

function helperErrorCode(error: unknown): string | undefined {
  const stderr =
    error && typeof error === "object" && "stderr" in error
      ? String(error.stderr)
      : "";
  const marker = stderr.indexOf(HELPER_ERROR_PREFIX);
  if (marker < 0) return undefined;
  return stderr.slice(marker + HELPER_ERROR_PREFIX.length).split(/\s/, 1)[0];
}

export async function updateRemoteTaskThroughApp(
  current: Pick<CodexState, "effort" | "model">,
  target: Pick<CodexState, "effort" | "model">,
  execute: HelperExecutor = async (executable, arguments_) =>
    execFileAsync(executable, arguments_, { timeout: 8000 }),
): Promise<void> {
  try {
    await execute(helperExecutablePath(), [
      "update",
      settingsLabel(current.model, current.effort),
      settingsLabel(target.model, target.effort),
    ]);
  } catch (error) {
    const code = helperErrorCode(error);
    if (code === "access_denied")
      throw new Error(
        "Allow Codex Controls Helper in macOS Accessibility settings.",
        { cause: error },
      );
    if (code === "screen_recording_denied")
      throw new Error(
        "Allow Codex Controls Helper in macOS Screen Recording settings.",
        { cause: error },
      );
    if (code === "control_missing" || code === "control_ambiguous")
      throw new Error("Codex model menu was not found in the front window.", {
        cause: error,
      });
    if (code === "target_missing" || code === "target_ambiguous")
      throw new Error(
        "The requested model and thinking pair is not in the Codex menu.",
        { cause: error },
      );
    if (code === "app_not_running" || code === "window_not_found")
      throw new Error("The Codex app window is not available.", {
        cause: error,
      });
    throw new Error(
      "Codex did not accept the remote settings through its UI.",
      {
        cause: error,
      },
    );
  }
}
