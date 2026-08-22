import { describe, expect, it } from "vitest";

import { sanitizeCodexRoute } from "../src/domain/route";

describe("Codex route", () => {
  it("accepts local and detected SSH routes", () => {
    expect(
      sanitizeCodexRoute({
        hostId: "local",
        threadId: "01a0286f-48d3-75b3-ab3d-f773412ab487",
      }),
    ).toEqual({
      hostId: "local",
      threadId: "01a0286f-48d3-75b3-ab3d-f773412ab487",
    });
    expect(
      sanitizeCodexRoute({
        hostId: "remote-ssh-discovered:dev",
        threadId: "01a0286f-48d3-75b3-ab3d-f773412ab487",
      }),
    ).toEqual({
      hostId: "remote-ssh-discovered:dev",
      threadId: "01a0286f-48d3-75b3-ab3d-f773412ab487",
    });
  });

  it.each([
    undefined,
    {},
    { hostId: "remote-ssh-discovered:-bad", threadId: "valid-thread-id" },
    { hostId: "unknown", threadId: "valid-thread-id" },
    { hostId: "local", threadId: "bad" },
  ])("rejects an invalid saved route", (value) => {
    expect(sanitizeCodexRoute(value)).toBeUndefined();
  });
});
