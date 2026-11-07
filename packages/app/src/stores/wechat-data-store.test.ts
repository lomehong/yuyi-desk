/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { YuyiClient } from "@/yuyi/api";
import { acquireWeChatData } from "./wechat-data-store";

vi.mock("@/runtime/host-runtime", () => ({ useHosts: () => [] }));

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
    fetchStatus: status,
    fetchPeers: peers,
    fetchInbox: vi.fn(),
    ackInbox: vi.fn(),
    chats: {
      fetchChatList: list,
      fetchChatHistory: vi.fn(),
      sendChat: vi.fn(),
      fetchChatUnread: unread,
      fetchChatPreview: vi.fn(),
      fetchChatTurns: vi.fn(),
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

    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.chats.fetchChatList).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
    expect(client.chats.fetchChatList).toHaveBeenCalledTimes(3);

    releaseFirst();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.chats.fetchChatList).toHaveBeenCalledTimes(4);

    releaseSecond();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(client.chats.fetchChatList).toHaveBeenCalledTimes(4);
  });
});
