/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";

describe("wechat selected peer persistence", { timeout: 30_000 }, () => {
  it("restores the selected peer after a module reload and clears it on deselection", async () => {
    window.localStorage.removeItem("yuyi:wechat-selected-peer");
    const store = await import("./wechat-mode-store");
    const peer = { serverId: "host-1", key: "agent-1:workspace", title: "Builder", kind: "agent" };

    store.topLevelModeStore.selectPeer(peer);
    expect(window.localStorage.getItem("yuyi:wechat-selected-peer")).toContain("host-1");

    vi.resetModules();
    const reloaded = await import("./wechat-mode-store");
    expect(reloaded.topLevelModeStore.getPeer()).toEqual(peer);

    reloaded.topLevelModeStore.selectPeer(null);
    expect(window.localStorage.getItem("yuyi:wechat-selected-peer")).toBeNull();
  });
});

describe("wechat observed peer mute persistence", { timeout: 30_000 }, () => {
  it("persists and restores a muted peer across module reloads", async () => {
    window.localStorage.removeItem("yuyi:wechat-muted-peers");
    const store = await import("./wechat-mode-store");

    store.wechatUiStore.togglePeerMuted("observe:agent:other");
    expect(store.wechatUiStore.isPeerMuted("observe:agent:other")).toBe(true);
    expect(window.localStorage.getItem("yuyi:wechat-muted-peers")).toContain("observe:agent:other");

    vi.resetModules();
    const reloaded = await import("./wechat-mode-store");
    expect(reloaded.wechatUiStore.isPeerMuted("observe:agent:other")).toBe(true);

    reloaded.wechatUiStore.togglePeerMuted("observe:agent:other");
    expect(reloaded.wechatUiStore.isPeerMuted("observe:agent:other")).toBe(false);
  });
});

describe("wechat message target", () => {
  it("selects the host and peer while preserving the exact message target", async () => {
    const store = await import("./wechat-mode-store");
    store.wechatUiStore.openMessageResult({
      serverId: "host-1",
      peerKey: "agent-1:workspace",
      messageId: "message-1",
    });

    expect(store.topLevelModeStore.getPeer()?.serverId).toBe("host-1");
    expect(store.wechatUiStore.getMessageTarget()).toEqual({
      serverId: "host-1",
      peerKey: "agent-1:workspace",
      messageId: "message-1",
    });
    store.wechatUiStore.clearMessageTarget();
    expect(store.wechatUiStore.getMessageTarget()).toBeNull();
  });
});
