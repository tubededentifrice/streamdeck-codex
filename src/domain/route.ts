export type CodexRoute = Readonly<{ hostId: string; threadId: string }>;

const THREAD_ID = /^[A-Za-z0-9_-]{8,128}$/;
const REMOTE_HOST_ID =
  /^remote-ssh-discovered:[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/;

export function sanitizeCodexRoute(value: unknown): CodexRoute | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const route = value as { hostId?: unknown; threadId?: unknown };
  if (
    typeof route.threadId !== "string" ||
    !THREAD_ID.test(route.threadId) ||
    typeof route.hostId !== "string" ||
    (route.hostId !== "local" && !REMOTE_HOST_ID.test(route.hostId))
  )
    return undefined;
  return { hostId: route.hostId, threadId: route.threadId };
}
