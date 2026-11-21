import type { AgentApp } from "../apps/front-app-watcher";

export type CodexErrorCode =
  | "accessibility"
  | "offline"
  | "remote-task"
  | "resolving-task"
  | "select-task"
  | "task-state-unavailable";

export class CodexError extends Error {
  readonly app: AgentApp;
  readonly code: CodexErrorCode;

  constructor(
    code: CodexErrorCode,
    message: string,
    options?: ErrorOptions & { app?: AgentApp },
  ) {
    super(message, options);
    this.app = options?.app ?? "codex";
    this.code = code;
  }
}

export function isResolvingTaskError(error: unknown): boolean {
  return error instanceof CodexError && error.code === "resolving-task";
}
