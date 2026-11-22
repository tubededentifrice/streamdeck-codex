import type { KeyAction } from "@elgato/streamdeck";
import { describe, expect, it, vi } from "vitest";

import { CodexController } from "../src/codex/controller";
import { CodexError } from "../src/codex/errors";
import type { ActionSettings, CodexState } from "../src/domain/settings";
import { defaultsFor } from "../src/domain/settings";

const LOCAL: CodexState = {
  effort: "medium",
  hostId: "local",
  model: "gpt-5.6-sol",
  threadId: "01a0289e-e3d3-7fc1-8774-bbc3bc4f0712",
};

const REMOTE: CodexState = {
  effort: "high",
  hostId: "remote-ssh-discovered:dev",
  model: "gpt-5.6-luna",
  threadId: "01a0289e-e3d3-7fc1-8774-bbc3bc4f0713",
};

function deferred<T>(): {
  promise: Promise<T>;
  reject: (error: Error) => void;
  resolve: (value: T) => void;
} {
  let reject!: (error: Error) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function fakeAction(): {
  action: KeyAction<ActionSettings>;
  images: string[];
  showAlert: ReturnType<typeof vi.fn>;
} {
  const images: string[] = [];
  const showAlert = vi.fn(async () => undefined);
  return {
    action: {
      id: "action-1",
      setImage: vi.fn(async (image: string) => {
        images.push(image);
      }),
      showAlert,
    } as unknown as KeyAction<ActionSettings>,
    images,
    showAlert,
  };
}

function fakeStyles() {
  return {
    lastRoute: undefined,
    onChange: () => () => undefined,
    saveLastRoute: async () => undefined,
    settings: {},
  };
}

describe("Codex controller refresh", () => {
  it("shows the inactive chat status instead of the previous task during navigation", async () => {
    let listener: () => void = () => undefined;
    let routeRevision = 1;
    let resolving = false;
    const client = {
      get routeRevision() {
        return routeRevision;
      },
      onChange: (next: () => void) => {
        listener = next;
        return () => undefined;
      },
      readState: vi.fn(async () => {
        if (resolving)
          throw new CodexError(
            "resolving-task",
            "Codex is resolving the selected task.",
          );
        return LOCAL;
      }),
      restoreRoute: () => undefined,
      update: vi.fn(),
    };
    const controller = new CodexController(client, fakeStyles());
    const { action, images } = fakeAction();
    controller.start();
    await controller.show(action, "model", defaultsFor("model"));
    expect(images.at(-1)).toContain("%3ESOL%3C");

    resolving = true;
    routeRevision = 2;
    listener();

    await vi.waitFor(() => {
      expect(images.at(-1)).toContain("NOT%20IN");
      expect(images.at(-1)).toContain("ACTIVE");
      expect(images.at(-1)).toContain("CHAT");
    });
    expect(images.at(-1)).not.toContain("%3ESOL%3C");
  });

  it("renders a new local route before an old read finishes", async () => {
    const oldRead = deferred<CodexState>();
    let listener: () => void = () => undefined;
    let routeRevision = 1;
    const readState = vi
      .fn<() => Promise<CodexState>>()
      .mockImplementationOnce(() => oldRead.promise)
      .mockResolvedValue(LOCAL);
    const client = {
      get routeRevision() {
        return routeRevision;
      },
      onChange: (next: () => void) => {
        listener = next;
        return () => undefined;
      },
      readState,
      restoreRoute: () => undefined,
      update: vi.fn(),
    };
    const controller = new CodexController(client, fakeStyles());
    const { action, images } = fakeAction();
    controller.start();

    const staleRefresh = controller.show(
      action,
      "preset",
      defaultsFor("preset"),
    );
    routeRevision = 2;
    listener();

    await vi.waitFor(() => {
      expect(images.at(-1)).toContain("%3ESOL%3C");
    });
    oldRead.reject(new Error("Old remote route timed out."));
    await staleRefresh;

    expect(images.at(-1)).toContain("%3ESOL%3C");
    expect(images.join("\n")).not.toContain("CODEX%20OFFLINE");
  });

  it("does not let an old remote update overwrite a new local route", async () => {
    const remoteUpdate = deferred<CodexState>();
    let listener: () => void = () => undefined;
    let routeRevision = 1;
    let state = REMOTE;
    const update = vi.fn(() => remoteUpdate.promise);
    const client = {
      get routeRevision() {
        return routeRevision;
      },
      onChange: (next: () => void) => {
        listener = next;
        return () => undefined;
      },
      readState: vi.fn(async () => state),
      restoreRoute: () => undefined,
      update,
    };
    const controller = new CodexController(client, fakeStyles());
    const { action, images, showAlert } = fakeAction();
    const settings = defaultsFor("preset");
    controller.start();
    await controller.show(action, "preset", settings);

    const press = controller.press(action, "preset", settings);
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    state = LOCAL;
    routeRevision = 2;
    listener();
    await vi.waitFor(() => {
      expect(images.at(-1)).toContain("%3ESOL%3C");
    });
    const localImageIndex = images.length - 1;

    remoteUpdate.reject(new Error("Remote Codex connection timed out."));
    await press;

    expect(images.slice(localImageIndex).at(-1)).toContain("%3ESOL%3C");
    expect(images.slice(localImageIndex).join("\n")).not.toContain(
      "UPDATE%20FAILED",
    );
    expect(showAlert).not.toHaveBeenCalled();
  });
});

describe("Codex controller single preset", () => {
  function staticClient(state: { current: CodexState }) {
    return {
      routeRevision: 1,
      onChange: () => () => undefined,
      readState: vi.fn(async () => state.current),
      restoreRoute: () => undefined,
      update: vi.fn(async (model: string, effort: string) => {
        state.current = { ...state.current, effort, model };
        return state.current;
      }),
    };
  }

  const settings: ActionSettings = {
    ...defaultsFor("single"),
    presets: [
      {
        effort: "high",
        label: "Luna",
        model: "gpt-5.6-luna",
        styleId: "builtin:violet",
      },
    ],
  };

  it("fades the key while the task uses other values", async () => {
    const state = { current: LOCAL };
    const controller = new CodexController(staticClient(state), fakeStyles());
    const { action, images } = fakeAction();
    await controller.show(action, "single", settings);
    const image = decodeURIComponent(images.at(-1)!);
    expect(image).toContain(">LUNA<");
    expect(image).not.toContain("stroke=");
  });

  it("shows the key as active when the task uses its preset", async () => {
    const state = { current: REMOTE };
    const controller = new CodexController(staticClient(state), fakeStyles());
    const { action, images } = fakeAction();
    await controller.show(action, "single", settings);
    expect(decodeURIComponent(images.at(-1)!)).toContain('stroke="#A78BFA"');
  });

  it("sets its preset on a press and then shows the active state", async () => {
    const state = { current: LOCAL };
    const client = staticClient(state);
    const controller = new CodexController(client, fakeStyles());
    const { action, images } = fakeAction();
    await controller.show(action, "single", settings);
    await controller.press(action, "single", settings);
    expect(client.update).toHaveBeenCalledWith(
      "gpt-5.6-luna",
      "high",
      LOCAL.threadId,
      LOCAL.hostId,
    );
    expect(decodeURIComponent(images.at(-1)!)).toContain('stroke="#A78BFA"');
  });

  it("lists the models that tasks used, newest first", async () => {
    const state = { current: LOCAL };
    const client = staticClient(state);
    const controller = new CodexController(client, fakeStyles());
    const { action } = fakeAction();
    await controller.show(action, "single", settings);
    state.current = REMOTE;
    expect(await controller.currentState()).toEqual({
      app: "codex",
      effort: "high",
      model: "gpt-5.6-luna",
      models: ["gpt-5.6-luna", "gpt-5.6-sol"],
    });
    client.readState.mockRejectedValueOnce(new Error("Offline."));
    expect(await controller.currentState()).toEqual({
      models: ["gpt-5.6-luna", "gpt-5.6-sol"],
    });
  });

  it("asks for valid settings when the preset is not valid", async () => {
    const state = { current: LOCAL };
    const controller = new CodexController(staticClient(state), fakeStyles());
    const { action, images } = fakeAction();
    await controller.show(action, "single", {
      ...settings,
      presets: [{ effort: "high", label: "Luna", model: "" }],
    });
    expect(decodeURIComponent(images.at(-1)!)).toContain("CHECK SETTINGS");
  });
});
