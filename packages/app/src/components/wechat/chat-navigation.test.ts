import { describe, expect, it } from "vitest";
import type { YuyiChatEntry, YuyiPeersEntry } from "@/yuyi/api";
import { isPeerStillAvailable, nextConversationKey, splitUnreadMessages } from "./chat-navigation";

function row(key: string): YuyiChatEntry {
  return { peer: { key, title: key, kind: "agent" }, lastAt: 1, lastText: "", unread: 0 };
}

describe("chat navigation", () => {
  it("splits the last unread entries behind a divider", () => {
    const messages = [
      { id: "a", at: 1, dir: "in" as const, text: "a" },
      { id: "b", at: 2, dir: "out" as const, text: "b" },
      { id: "c", at: 3, dir: "in" as const, text: "c" },
    ];

    expect(splitUnreadMessages(messages, 2)).toEqual({
      read: [messages[0]],
      unread: [messages[1], messages[2]],
    });
    expect(splitUnreadMessages(messages, 0)).toEqual({ read: messages, unread: [] });
  });

  it("cycles conversations and skips observed rows", () => {
    const rows = [
      row("a:one"),
      row("b:two"),
      {
        ...row("observe:c"),
        peer: { key: "observe:c", title: "observed", kind: "observe" as const },
      },
    ];

    expect(nextConversationKey(rows, "a:one", 1)).toBe("b:two");
    expect(nextConversationKey(rows, "b:two", 1)).toBe("a:one");
    expect(nextConversationKey(rows, "a:one", -1)).toBe("b:two");
    expect(nextConversationKey(rows, null, 1)).toBe("a:one");
  });

  it("accepts conversations and canonical peer directory entries, but rejects stale peers", () => {
    const peers: YuyiPeersEntry[] = [
      { device: "dev", agentId: "agent-1", sessions: [{ sessionID: "raw", name: "new" }] },
    ];
    const selected = { key: "agent-1:new", title: "New", kind: "agent" };

    expect(isPeerStillAvailable(selected, [], peers, null)).toBe(true);
    expect(isPeerStillAvailable(selected, [row("agent-1:new")], [], null)).toBe(true);
    expect(isPeerStillAvailable({ ...selected, key: "stale:old" }, [], peers, null)).toBe(false);
  });
});
