import { describe, expect, it, vi } from "vitest";

import {
  RemoteTaskUpdater,
  sshAliasFromHostId,
  sshArguments,
  type RemoteAppServerClient,
} from "../src/codex/remote-app-server";

const CURRENT = {
  effort: "high",
  hostId: "remote-ssh-discovered:dev",
  model: "gpt-5.6-luna",
  threadId: "01a0286f-48d3-75b3-ab3d-f773412ab487",
};
const TARGET = { effort: "medium", model: "gpt-5.6-sol" };

describe("remote Codex App Server", () => {
  it("extracts the SSH alias that Codex reports for the selected task", () => {
    expect(sshAliasFromHostId("remote-ssh-discovered:dev")).toBe("dev");
    expect(sshAliasFromHostId("remote-ssh-discovered:build.example-1")).toBe(
      "build.example-1",
    );
  });

  it.each([
    "local",
    "remote-ssh-discovered:",
    "remote-ssh-discovered:-oProxyCommand=bad",
    "remote-ssh-discovered:dev;bad",
  ])("rejects an unsafe or unsupported host ID: %s", (hostId) => {
    expect(() => sshAliasFromHostId(hostId)).toThrow();
  });

  it("uses a fixed non-interactive SSH command", () => {
    expect(sshArguments("dev")).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=5",
      "-o",
      "PermitLocalCommand=no",
      "-o",
      "ServerAliveCountMax=2",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "StrictHostKeyChecking=yes",
      "dev",
      "codex",
      "app-server",
      "proxy",
    ]);
  });

  it("reuses one connection for the detected host", async () => {
    const update = vi.fn(
      async (_threadId: string, target: typeof TARGET) => target,
    );
    const close = vi.fn();
    const connect = vi.fn(async (): Promise<RemoteAppServerClient> => ({
      close,
      update,
    }));
    const updater = new RemoteTaskUpdater(connect);

    await updater.update(CURRENT, TARGET);
    await updater.update(CURRENT, {
      effort: "high",
      model: "gpt-5.6-luna",
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith("dev");
    expect(update).toHaveBeenNthCalledWith(1, CURRENT.threadId, TARGET);
    expect(update).toHaveBeenCalledTimes(2);
    updater.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("reconnects once after a failed remote request", async () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const connect = vi
      .fn<() => Promise<RemoteAppServerClient>>()
      .mockResolvedValueOnce({
        close: firstClose,
        update: vi.fn(async () => {
          throw new Error("connection closed");
        }),
      })
      .mockResolvedValueOnce({
        close: secondClose,
        update: vi.fn(async (_threadId, target) => target),
      });
    const updater = new RemoteTaskUpdater(connect);

    await expect(updater.update(CURRENT, TARGET)).resolves.toEqual(TARGET);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(firstClose).toHaveBeenCalledOnce();
    updater.close();
    expect(secondClose).toHaveBeenCalledOnce();
  });

  it("reports a bounded error after two failed connections", async () => {
    const connect = vi.fn(async () => {
      throw new Error("private SSH detail");
    });
    const updater = new RemoteTaskUpdater(connect);

    await expect(updater.update(CURRENT, TARGET)).rejects.toThrow(
      "Codex could not update the selected remote task through SSH.",
    );
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
