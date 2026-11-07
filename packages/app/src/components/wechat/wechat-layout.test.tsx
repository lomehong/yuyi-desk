/** @vitest-environment jsdom */
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeChatMain } from "./wechat-layout";
import {
  KeyboardActionDispatcherProvider,
  useKeyboardActionDispatcher,
} from "@/keyboard/keyboard-action-dispatcher-context";
import { topLevelModeStore, wechatUiStore } from "@/stores/wechat-mode-store";
import { i18n } from "@/i18n/i18next";

const dispatcher = vi.hoisted(() => ({
  current: null as ReturnType<typeof useKeyboardActionDispatcher> | null,
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [{ serverId: "host-1" }],
}));

vi.mock("@/stores/wechat-data-store", () => ({
  useWeChatData: () => ({
    conversations: [
      {
        peer: { key: "agent-1:one", title: "One", kind: "agent" },
        lastAt: 2,
        lastText: "first",
        unread: 0,
      },
      {
        peer: { key: "agent-2:two", title: "Two", kind: "agent" },
        lastAt: 1,
        lastText: "second",
        unread: 0,
      },
    ],
    peers: [],
    status: null,
    unread: 0,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/screens/agent-chat-screen", () => ({
  AgentChatScreen: ({ title }: { title: string }) => <span>{title}</span>,
}));

vi.mock("./directory-overlay", () => ({
  DirectoryOverlay: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="wechat-directory-overlay" /> : null,
}));

function DispatcherProbe() {
  dispatcher.current = useKeyboardActionDispatcher();
  return null;
}

describe("WeChatMain keyboard integration", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
    topLevelModeStore.set("wechat");
    topLevelModeStore.selectPeer(null);
    wechatUiStore.closeDirectory();
    wechatUiStore.setSearch("");
    dispatcher.current = null;
  });

  afterEach(async () => {
    cleanup();
    topLevelModeStore.set("workbench");
    topLevelModeStore.selectPeer(null);
    await i18n.changeLanguage("en");
  });

  function renderMain() {
    return render(
      <KeyboardActionDispatcherProvider>
        <DispatcherProbe />
        <WeChatMain />
      </KeyboardActionDispatcherProvider>,
    );
  }

  it("opens and closes the directory through the real dispatcher", () => {
    renderMain();

    let handled = false;
    act(() => {
      handled = dispatcher.current?.dispatch({ id: "wechat.new-chat", scope: "sidebar" }) ?? false;
    });
    expect(handled).toBe(true);
    expect(screen.getByTestId("wechat-directory-overlay")).toBeTruthy();

    act(() => {
      handled = dispatcher.current?.dispatch({ id: "wechat.escape", scope: "sidebar" }) ?? false;
    });
    expect(handled).toBe(true);
    expect(screen.queryByTestId("wechat-directory-overlay")).toBeNull();
  });

  it("moves to the next non-observed conversation", () => {
    topLevelModeStore.selectPeer({ key: "agent-1:one", title: "One", kind: "agent" });
    renderMain();

    let handled = false;
    act(() => {
      handled = dispatcher.current?.dispatch({ id: "wechat.conv.next", scope: "sidebar" }) ?? false;
    });
    expect(handled).toBe(true);
    expect(topLevelModeStore.getPeer()?.key).toBe("agent-2:two");
    expect(screen.getByText("Two")).toBeTruthy();
  });
});
