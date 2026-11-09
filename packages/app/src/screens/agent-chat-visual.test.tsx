/** @vitest-environment jsdom */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Bubble,
  ChatComposerPane,
  ChatHeaderPane,
  DeliveryGlyph,
  NewMessageCapsule,
} from "./agent-chat-screen";
import { i18n } from "@/i18n/i18next";
import type { YuyiChatMessage } from "@/yuyi/api";

vi.mock("lucide-react-native", () => {
  const Icon = ({ testID, ...props }: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-testid": testID });
  return {
    ArrowLeftRight: Icon,
    ArrowUpRight: Icon,
    Check: Icon,
    CheckCircle: Icon,
    ChevronDown: Icon,
    ChevronLeft: Icon,
    ChevronRight: Icon,
    Clock: Icon,
    CornerUpLeft: Icon,
    Inbox: Icon,
    Loader2: Icon,
    Mail: Icon,
    MoreHorizontal: Icon,
    Send: Icon,
    Trash2: Icon,
    XCircle: Icon,
  };
});

vi.mock("@/components/wechat/agent-avatar", () => ({ AgentAvatar: () => null }));
vi.mock("@/components/wechat/agent-identity-badge", () => ({ AgentIdentityBadge: () => null }));
vi.mock("@/components/wechat/forward-sheet", () => ({ ForwardSheet: () => null }));
vi.mock("@/components/wechat/linkified-text", () => ({
  LinkifiedText: ({ text }: { text: string }) => React.createElement("span", null, text),
}));
vi.mock("@/components/wechat/result-card", () => ({
  ResultCard: () => null,
  buildForwardSnapshot: vi.fn(),
  groupObservedTurns: vi.fn(() => []),
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => children,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => children,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => children,
}));

const incoming: YuyiChatMessage = {
  id: "incoming-first",
  at: 1,
  dir: "in",
  text: "first incoming",
  from: { role: "owner", name: "Owner" },
};

const outgoing: YuyiChatMessage = {
  id: "outgoing-last",
  at: 2,
  dir: "out",
  text: "outgoing",
};

// 模块级常量：避免在 render 同作用域内联对象字面量（jsx-no-new-object-as-prop）
const injectedOutgoing: YuyiChatMessage = {
  ...outgoing,
  ack: { ok: true, delivery: "injected" },
};

const nullInputRef = { current: null };

describe("Agent chat P1 visual feedback", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  it("shapes the first incoming bubble and last outgoing bubble as group corners", () => {
    render(
      <>
        <Bubble msg={incoming} now={2} groupPosition="first" />
        <Bubble msg={outgoing} now={2} groupPosition="last" />
      </>,
    );

    expect(screen.getByTestId("wechat-bubble-incoming-first").style.borderTopLeftRadius).toBe(
      "4px",
    );
    expect(screen.getByTestId("wechat-bubble-outgoing-last").style.borderBottomRightRadius).toBe(
      "4px",
    );
  });

  it("uses the amber treatment for an incoming Owner bubble", () => {
    render(<Bubble msg={incoming} now={2} />);

    expect(screen.getByTestId("wechat-bubble-incoming-first").style.backgroundColor).toContain(
      "245, 158, 11",
    );
  });

  it("shows an icon next to the delivery state", () => {
    render(<DeliveryGlyph kind="delivered" />);

    expect(screen.getByTestId("wechat-delivery-delivered")).toBeTruthy();
  });

  it("uses the protocol terminal outcome for the outgoing bubble", () => {
    render(<Bubble msg={injectedOutgoing} now={2_000} turnOutcome="completed-without-reply" />);

    expect(screen.getByTestId("wechat-delivery-noReply")).toBeTruthy();
    expect(screen.queryByTestId("wechat-delivery-injected")).toBeNull();
  });

  it("pulses a blue running dot in the header from the real busy signal", () => {
    render(
      <ChatHeaderPane
        peerKind="agent"
        peerTitle="Builder"
        peerKey="agent-1:workspace"
        sessionOptions={[]}
        onSelectSession={vi.fn()}
        isLocal
        readOnly={false}
        peerOnline
        peerBusy
        onlineText="在线"
        onCopyPeerKey={vi.fn()}
        onGoWorkbench={vi.fn()}
        onRefresh={vi.fn()}
        onForwardWholeConversation={vi.fn()}
      />,
    );

    expect(screen.getByTestId("wechat-header-busy-dot").style.backgroundColor).toBe(
      "rgb(38, 138, 224)",
    );
  });

  it("lays out composer actions horizontally instead of squeezing labels into icon buttons", () => {
    render(
      <ChatComposerPane
        readOnly={false}
        peerKey="agent-1:workspace"
        peerTitle="Builder"
        peerOnline
        isLocal
        draft="draft"
        sending={false}
        inputRef={nullInputRef}
        lastReplyText="reply"
        onQuoteReply={vi.fn()}
        onClearDraft={vi.fn()}
        onGoWorkbench={vi.fn()}
        onDraftChange={vi.fn()}
        onInputKeyPress={vi.fn()}
        onSend={vi.fn()}
        onForwardWholeConversation={vi.fn()}
      />,
    );

    const quote = screen.getByTestId("wechat-quote-reply-action");
    expect(quote.style.flexDirection).toBe("row");
    expect(quote.style.width).not.toBe("22px");
  });

  it("keeps the new-message capsule horizontal", () => {
    render(<NewMessageCapsule count={12} onPress={vi.fn()} />);

    const capsule = screen.getByTestId("wechat-new-message-capsule");
    expect(capsule.style.flexDirection).toBe("row");
    expect(capsule.style.width).not.toBe("22px");
  });

  it("highlights the targeted search message", () => {
    render(<Bubble msg={incoming} now={2} highlighted />);

    expect(screen.getByTestId("wechat-bubble-incoming-first").style.outlineStyle).toBe("solid");
  });
});
