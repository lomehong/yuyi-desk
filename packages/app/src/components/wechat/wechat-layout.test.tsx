/** @vitest-environment jsdom */
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { relativeTime, WeChatMain, WeChatSidebar } from "./wechat-layout";
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
  useHosts: () => [
    {
      serverId: "host-1",
      connections: [{ type: "directTcp", endpoint: "localhost:6767" }],
    },
  ],
}));

vi.mock("lucide-react-native", () => {
  const Icon = () => React.createElement("span");
  return {
    AlertTriangle: Icon,
    Bell: Icon,
    BellOff: Icon,
    Bot: Icon,
    Check: Icon,
    CheckCircle: Icon,
    ChevronDown: Icon,
    ChevronLeft: Icon,
    ChevronRight: Icon,
    Eye: Icon,
    MessageSquarePlus: Icon,
    MoreHorizontal: Icon,
    RefreshCw: Icon,
    Search: Icon,
    Users: Icon,
  };
});

const wechatLoadState = vi.hoisted(() => ({ loaded: false, error: null as string | null }));

vi.mock("@/stores/wechat-data-store", () => ({
  useWeChatData: () => ({
    loaded: wechatLoadState.loaded,
    error: wechatLoadState.error,
    conversations: [
      {
        peer: { key: "agent-1:one", title: "One", kind: "agent" },
        lastAt: 2,
        lastText: "first",
        unread: 1,
      },
      {
        peer: { key: "agent-2:two", title: "Two", kind: "agent" },
        lastAt: 1,
        lastText: "second",
        unread: 0,
      },
      {
        peer: { key: "observe:agent-1:owner", title: "One ↔ Owner", kind: "observe" },
        lastAt: 0,
        lastText: "observed",
        unread: 0,
      },
      {
        peer: { key: "agent-3:archived", title: "Archived", kind: "agent" },
        lastAt: 0,
        lastText: "archived",
        unread: 0,
        archivedAt: 1,
      },
    ],
    peers: [],
    status: null,
    unread: 0,
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

const approvalState = vi.hoisted(() => ({
  approval: null as null | { summary: string; state: "pending"; expiresAt: number },
}));
vi.mock("@/stores/wechat-approval-store", () => ({
  useApproval: () => approvalState.approval,
  useApprovals: () => ({ approvals: [], refresh: vi.fn(), resolve: vi.fn() }),
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
    wechatUiStore.setConversationFilter("all");
    wechatUiStore.clearMessageTarget();
    wechatUiStore.closeApproval();
    approvalState.approval = null;
    dispatcher.current = null;
    wechatLoadState.loaded = false;
    wechatLoadState.error = null;
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

  it("raises the timestamp color on an unread conversation", () => {
    render(
      <KeyboardActionDispatcherProvider>
        <WeChatSidebar />
      </KeyboardActionDispatcherProvider>,
    );

    expect(screen.getAllByText("1/1")[0].style.color).toBe(screen.getByText("One").style.color);
  });

  it("shows archived conversations only in the archived filter", () => {
    render(
      <KeyboardActionDispatcherProvider>
        <WeChatSidebar />
      </KeyboardActionDispatcherProvider>,
    );

    expect(screen.queryByText("Archived")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "已归档" }));
    expect(screen.getByText("Archived")).toBeTruthy();
  });

  it("updates an observed row immediately when muted", () => {
    const peerKey = "observe:agent-1:owner";
    if (wechatUiStore.isPeerMuted(peerKey)) wechatUiStore.togglePeerMuted(peerKey);
    wechatUiStore.setObserveExpanded(true);
    render(
      <KeyboardActionDispatcherProvider>
        <WeChatSidebar />
      </KeyboardActionDispatcherProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "静音" }));

    expect(screen.getByRole("button", { name: "取消静音" })).toBeTruthy();
    wechatUiStore.togglePeerMuted(peerKey);
  });

  it("shows a secondary action hint on the welcome screen", () => {
    renderMain();

    expect(screen.getByText("或从左侧列表选择会话")).toBeTruthy();
  });

  it("formats absolute dates with the active i18n locale", () => {
    const translate = (key: string) => key;
    expect(relativeTime(86_400_000, translate, "en-US")).toBe("1/2");
    expect(relativeTime(86_400_000, translate, "en-GB")).toBe("02/01");
  });

  it("keeps the selected peer when the latest host load failed", () => {
    topLevelModeStore.selectPeer({ key: "stale:unknown", title: "Stale", kind: "agent" });
    wechatLoadState.loaded = true;
    wechatLoadState.error = "wechat.errorConnection";

    renderMain();

    expect(topLevelModeStore.getPeer()?.key).toBe("stale:unknown");
  });

  it("shows a notified approval on the welcome screen without a selected Agent", () => {
    approvalState.approval = {
      summary: "允许读取工作区",
      state: "pending",
      expiresAt: Date.now() + 60_000,
    };
    wechatUiStore.openApproval("approval-1");
    renderMain();

    expect(screen.getByText("允许读取工作区")).toBeTruthy();
  });
});
