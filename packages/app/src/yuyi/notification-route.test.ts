import { describe, expect, it } from "vitest";
import { resolveNotificationPeer } from "./notification-route";

describe("resolveNotificationPeer", () => {
  it("returns the selected conversation identity for a canonical peer key", () => {
    expect(
      resolveNotificationPeer("agent-1:workspace-a", [
        {
          peer: { key: "agent-1:workspace-a", title: "Builder", kind: "agent" },
          lastAt: 1,
          lastText: "done",
          unread: 1,
        },
      ]),
    ).toEqual({ key: "agent-1:workspace-a", title: "Builder", kind: "agent" });
  });

  it("rejects an unknown peer instead of opening a stale or fabricated conversation", () => {
    expect(resolveNotificationPeer("missing:workspace", [])).toBeNull();
  });
});
