export type CodexErrorCode =
  "offline" | "resolving-task" | "select-task" | "task-state-unavailable";

export class CodexError extends Error {
  readonly code: CodexErrorCode;

  constructor(code: CodexErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export function isResolvingTaskError(error: unknown): boolean {
  return error instanceof CodexError && error.code === "resolving-task";
}
