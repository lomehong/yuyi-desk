/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { YuyiClient } from "@/yuyi/api";
import {
  acquireWeChatData,
  applyWeChatChatEvent,
  getWeChatDataSnapshot,
} from "./wechat-data-store";

vi.mock("@/runtime/host-runtime", () => ({ useHosts: () => [] }));
vi.mock("@/yuyi/chat-events", () => ({
  streamChatEvents: vi.fn(() => new Promise<void>(() => undefined)),
}));

function fakeClient(): YuyiClient {
  const list = vi.fn(async () => []);
  const peers = vi.fn(async () => []);
  const status = vi.fn(async () => ({
    connected: true,
    hub: "hub",
    device: "device",
    principal: "device" as const,
    bindings: [],
  }));
  const unread = vi.fn(async () => 0);
  return {
    origin: "http://localhost",
    bearer: null,
    locateAgent: vi.fn(),
    fetchStatus: status,
    fetchPeers: peers,
    fetchInbox: vi.fn(),
    ackInbox: vi.fn(),
    chats: {
      fetchChatList: list,
      fetchChatHistory: vi.fn(),
      searchChatMessages: vi.fn(),
      setChatArchived: vi.fn(),
      setChatPinned: vi.fn(),
      deleteChat: vi.fn(),
      sendChat: vi.fn(),
      fetchChatUnread: unread,
      fetchChatPreview: vi.fn(),
      fetchChatTurns: vi.fn(),
      markChatRead: vi.fn(),
      setChatMuted: vi.fn(),
      notifySuppress: vi.fn(),
    },
  };
}

describe("acquireWeChatData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shares one polling schedule between consumers and refreshes immediately on focus", async () => {
    const client = fakeClient();
    const releaseFirst = acquireWeChatData(client, "host-1");
    const releaseSecond = acquireWeChatData(client, "host-1");
    await Promise.resolve();
    await Promise.resolve();

    expect(client.chats.fetchChatList).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.chats.fetchChatList).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
    expect(client.chats.fetchChatList).toHaveBeenCalledTimes(3);

    releaseFirst();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.chats.fetchChatList).toHaveBeenCalledTimes(4);

    releaseSecond();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(client.chats.fetchChatList).toHaveBeenCalledTimes(4);
  });
});

describe("wechat host partitions", () => {
  it("does not let a late response from the previous host overwrite the active host", async () => {
    let resolveFirst: ((value: never[]) => void) | undefined;
    const first = fakeClient();
    first.chats.fetchChatList = vi.fn(
      () =>
        new Promise<never[]>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const second = fakeClient();
    const secondRow = {
      peer: { key: "agent-2:workspace", title: "Second", kind: "agent" as const },
      lastAt: 2,
      lastText: "second host",
      unread: 0,
    };
    second.chats.fetchChatList = vi.fn(async () => [secondRow]);

    const releaseFirst = acquireWeChatData(first, "host-1");
    const releaseSecond = acquireWeChatData(second, "host-2");
    await vi.waitFor(() => {
      expect(getWeChatDataSnapshot("host-2").conversations[0]?.peer.key).toBe("agent-2:workspace");
    });

    resolveFirst?.([]);
    await Promise.resolve();
    expect(getWeChatDataSnapshot("host-2").conversations[0]?.peer.key).toBe("agent-2:workspace");
    expect(getWeChatDataSnapshot("host-2").loaded).toBe(true);

    releaseFirst();
    releaseSecond();
  });
});

describe("turn event projections", () => {
  it("partitions turns by server and replyTo and ignores duplicates", () => {
    applyWeChatChatEvent("host-turn-a", {
      kind: "turn-changed",
      peerKey: "agent-1:one",
      turn: { replyTo: "message-1", agentId: "agent-1", outcome: "started", at: 10 },
    });
    applyWeChatChatEvent("host-turn-a", {
      kind: "turn-changed",
      peerKey: "agent-1:one",
      turn: { replyTo: "message-1", agentId: "agent-1", outcome: "started", at: 10 },
    });
    applyWeChatChatEvent("host-turn-b", {
      kind: "turn-changed",
      peerKey: "agent-2:two",
      turn: { replyTo: "message-1", agentId: "agent-2", outcome: "failed", at: 11 },
    });

    expect(getWeChatDataSnapshot("host-turn-a").turnsByReplyTo["message-1"]?.outcome).toBe(
      "started",
    );
    expect(getWeChatDataSnapshot("host-turn-a").eventRevision).toBe(1);
    expect(getWeChatDataSnapshot("host-turn-b").turnsByReplyTo["message-1"]?.outcome).toBe(
      "failed",
    );
  });

  it("does not let a late started event regress a terminal outcome", () => {
    applyWeChatChatEvent("host-turn-order", {
      kind: "turn-changed",
      peerKey: "agent-1:one",
      turn: {
        replyTo: "message-2",
        agentId: "agent-1",
        outcome: "completed-without-reply",
        at: 20,
      },
    });
    applyWeChatChatEvent("host-turn-order", {
      kind: "turn-changed",
      peerKey: "agent-1:one",
      turn: { replyTo: "message-2", agentId: "agent-1", outcome: "started", at: 21 },
    });

    expect(getWeChatDataSnapshot("host-turn-order").turnsByReplyTo["message-2"]?.outcome).toBe(
      "completed-without-reply",
    );
  });
});

describe("offline Hub behavior", () => {
  it("keeps local chat data loading without repeatedly requesting Hub peers", async () => {
    const client = fakeClient();
    client.fetchStatus = vi.fn(async () => ({
      connected: false,
      hub: "hub",
      device: "device",
      principal: null,
      bindings: [],
    }));
    client.fetchPeers = vi.fn(async () => {
      throw new Error("yuyi hub offline");
    });
    const release = acquireWeChatData(client, "host-offline");

    await vi.waitFor(() => {
      expect(getWeChatDataSnapshot("host-offline").loaded).toBe(true);
    });
    expect(client.fetchPeers).not.toHaveBeenCalled();
    expect(getWeChatDataSnapshot("host-offline").peers).toEqual([]);
    expect(getWeChatDataSnapshot("host-offline").error).toBeNull();
    release();
  });
});
