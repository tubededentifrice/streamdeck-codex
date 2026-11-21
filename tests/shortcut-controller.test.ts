import type { KeyAction } from "@elgato/streamdeck";
import { describe, expect, it, vi } from "vitest";

import { ShortcutController } from "../src/codex/shortcut-controller";
import type { ActionSettings } from "../src/domain/settings";

function fakeAction(): {
  action: KeyAction<ActionSettings>;
  images: string[];
  showAlert: ReturnType<typeof vi.fn>;
} {
  const images: string[] = [];
  const showAlert = vi.fn(async () => undefined);
  return {
    action: {
      id: "shortcut-1",
      setImage: vi.fn(async (image: string) => images.push(image)),
      showAlert,
    } as unknown as KeyAction<ActionSettings>,
    images,
    showAlert,
  };
}

const styles = {
  onChange: () => () => undefined,
  settings: {},
};

describe("shortcut controller", () => {
  it("does not run the same shortcut twice during a rapid double press", async () => {
    let finish!: () => void;
    const opening = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const launcher = { open: vi.fn(() => opening) };
    const controller = new ShortcutController(launcher, styles);
    const { action } = fakeAction();
    const settings: ActionSettings = {
      shortcuts: [{ label: "Review", shortcut: "review" }],
    };
    await controller.show(action, settings);

    const first = controller.press(action, settings);
    const second = controller.press(action, settings);
    await second;

    await vi.waitFor(() => expect(launcher.open).toHaveBeenCalledOnce());
    finish();
    await first;
  });

  it("uses only the first configured shortcut", async () => {
    const launcher = { open: vi.fn(async () => undefined) };
    const controller = new ShortcutController(launcher, styles);
    const { action, images } = fakeAction();
    const settings: ActionSettings = {
      shortcuts: [
        { label: "Review", shortcut: "review", styleId: "builtin:emerald" },
        {
          label: "Terminal",
          shortcut: "terminal",
          styleId: "builtin:violet",
        },
      ],
    };

    await controller.show(action, settings);
    expect(images.at(-1)).toContain("%3EREVIEW%3C");
    expect(images.at(-1)).not.toContain("NEXT");

    await controller.press(action, settings);
    expect(launcher.open).toHaveBeenNthCalledWith(1, "review", "codex");

    await controller.press(action, settings);
    expect(launcher.open).toHaveBeenNthCalledWith(2, "review", "codex");
    expect(images.at(-1)).toContain("%3EREVIEW%3C");
  });

  it("renders a shared custom color preset", async () => {
    const launcher = { open: vi.fn(async () => undefined) };
    const controller = new ShortcutController(launcher, {
      onChange: () => () => undefined,
      settings: {
        customStyles: [
          {
            backgroundColor: "#112233",
            borderColor: "#445566",
            fontColor: "#DDEEFF",
            id: "custom:shortcut",
            name: "Shortcut",
          },
        ],
      },
    });
    const { action, images } = fakeAction();

    await controller.show(action, {
      shortcuts: [
        {
          label: "Browser",
          shortcut: "browser",
          styleId: "custom:shortcut",
        },
      ],
    });

    expect(images.at(-1)).toContain("fill%3D%22%23112233%22");
    expect(images.at(-1)).toContain("stroke%3D%22%23445566%22");
    expect(images.at(-1)).toContain("fill%3D%22%23DDEEFF%22");
  });

  it("shows an alert and does not advance after a failed command", async () => {
    const launcher = {
      open: vi.fn(async () => {
        throw new Error("Private command error");
      }),
    };
    const controller = new ShortcutController(launcher, styles);
    const { action, images, showAlert } = fakeAction();
    const settings: ActionSettings = {
      shortcuts: [
        { label: "Review", shortcut: "review", styleId: "builtin:emerald" },
      ],
    };

    await controller.show(action, settings);
    await controller.press(action, settings);

    expect(images.at(-1)).toContain("OPEN%20FAILED");
    expect(images.join("\n")).not.toContain("Private%20command%20error");
    expect(showAlert).toHaveBeenCalledOnce();

    await controller.settingsChanged(action, settings);
    expect(images.at(-1)).toContain("%3EREVIEW%3C");
  });
});
