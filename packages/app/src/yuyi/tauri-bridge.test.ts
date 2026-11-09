import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface DesktopBridgeUnderTest {
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  events?: {
    on: (event: string, handler: (payload: unknown) => void) => Promise<() => void>;
  };
}

const invoke = vi.fn();
const listen = vi.fn();

async function loadBridge(): Promise<DesktopBridgeUnderTest> {
  await import("./tauri-bridge");
  return (globalThis as Record<string, unknown>).paseoDesktop as DesktopBridgeUnderTest;
}

describe("Tauri desktop bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
    listen.mockReset();
    const global = globalThis as Record<string, unknown>;
    delete global.paseoDesktop;
    delete global.__YUYI_SHELL_CACHED__;
    global.__TAURI__ = {
      core: { invoke },
      event: { listen },
      window: {
        getCurrentWindow: () => ({
          minimize: vi.fn(),
          toggleMaximize: vi.fn(),
          close: vi.fn(),
          isMaximized: vi.fn(async () => false),
          isFullscreen: vi.fn(async () => false),
          startDragging: vi.fn(),
          onResized: vi.fn(),
        }),
      },
    };
  });

  afterEach(() => {
    const global = globalThis as Record<string, unknown>;
    delete global.__TAURI__;
    delete global.paseoDesktop;
    delete global.__YUYI_SHELL_CACHED__;
  });

  it("subscribes to desktop events and returns the native unlisten callback", async () => {
    const unlisten = vi.fn();
    listen.mockResolvedValue(unlisten);
    const bridge = await loadBridge();
    expect(typeof bridge.events?.on).toBe("function");

    const handler = vi.fn();
    const result = await bridge.events!.on("quitting", handler);
    expect(listen).toHaveBeenCalledWith("quitting", expect.any(Function));
    const nativeListener = listen.mock.calls[0][1] as (event: unknown) => void;
    nativeListener({ payload: { reason: "test" } });
    expect(handler).toHaveBeenCalledWith({ payload: { reason: "test" } });
    expect(result).toBe(unlisten);
  });

  it("forwards idle-time and attachment garbage-collection commands to Tauri", async () => {
    invoke.mockResolvedValueOnce(42).mockResolvedValueOnce(2);
    const bridge = await loadBridge();

    await expect(bridge.invoke!("desktop_get_system_idle_time")).resolves.toBe(42);
    await expect(
      bridge.invoke!("garbage_collect_attachment_files", { referencedIds: ["keep"] }),
    ).resolves.toBe(2);
    expect(invoke).toHaveBeenNthCalledWith(1, "desktop_get_system_idle_time", undefined);
    expect(invoke).toHaveBeenNthCalledWith(2, "garbage_collect_attachment_files", {
      referencedIds: ["keep"],
    });
  });
});
