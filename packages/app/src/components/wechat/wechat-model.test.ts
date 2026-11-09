import { describe, expect, it } from "vitest";
import type { YuyiChatEntry, YuyiPeersEntry, YuyiStatus } from "@/yuyi/api";
import {
  buildDirectoryGroups,
  canonicalPeerKey,
  formatUnreadCount,
  groupAgentRows,
  searchConversationsAndAgents,
} from "./wechat-model";

function conversation(
  key: string,
  title: string,
  lastAt: number,
  unread = 0,
  kind: "owner" | "agent" | "observe" | "task" = "agent",
): YuyiChatEntry {
  return {
    peer: { key, title, kind },
    lastAt,
    lastText: `message for ${title}`,
    unread,
  };
}

const peers: YuyiPeersEntry[] = [
  {
    device: "dev-laptop",
    agentId: "agent-1",
    role: "worker",
    activity: { busy: true, doing: "Review", repo: "yuyi" },
    sessions: [
      { sessionID: "raw-session-1", name: "workspace-a" },
      { sessionID: "raw-session-2", name: "workspace-b" },
    ],
  },
];

describe("groupAgentRows", () => {
  it("groups sessions by agent, sorts by latest activity and sums unread", () => {
    const rows = groupAgentRows([
      conversation("agent-1:workspace-a", "Builder", 100, 2),
      conversation("agent-1:workspace-b", "Builder review", 300, 4),
      conversation("agent-2:workspace-c", "Hermes", 200, 1),
    ]);

    expect(rows.map((row) => row.agentId)).toEqual(["agent-1", "agent-2"]);
    expect(rows[0]?.title).toBe("Builder review");
    expect(rows[0]?.unread).toBe(6);
    expect(rows[0]?.sessions.map((session) => session.peer.key)).toEqual([
      "agent-1:workspace-b",
      "agent-1:workspace-a",
    ]);
  });

  it("caps a large unread count without changing its numeric value", () => {
    const rows = groupAgentRows([conversation("agent-1:a", "Builder", 100, 120)]);

    expect(rows[0]?.unread).toBe(120);
    expect(groupAgentRows([conversation("task:task_root", "任务", 999, 1, "task")])).toEqual([]);
    expect(formatUnreadCount(rows[0]?.unread ?? 0)).toBe("99+");
    expect(formatUnreadCount(99)).toBe("99");
  });
});

describe("canonicalPeerKey", () => {
  it("only creates agentId:name keys", () => {
    expect(canonicalPeerKey("agent-1", "workspace-a")).toBe("agent-1:workspace-a");
    expect(canonicalPeerKey("agent-1", undefined)).toBeNull();
    expect(canonicalPeerKey(undefined, "workspace-a")).toBeNull();
    expect(canonicalPeerKey("agent-1", "  ")).toBeNull();
  });
});

describe("buildDirectoryGroups", () => {
  it("keeps online agents separate from local bindings and recent offline conversations", () => {
    const status: YuyiStatus = {
      connected: true,
      hub: "hub",
      device: "local",
      principal: "device",
      bindings: [{ name: "local-workspace", agentId: "local-agent", paseoAgentId: "paseo-1" }],
    };
    const groups = buildDirectoryGroups(peers, status, [
      conversation("offline-agent:old", "Offline Builder", 100),
    ]);

    expect(groups.map((group) => group.id)).toEqual(["remote", "local", "offline"]);
    expect(groups[0]?.entries[0]?.key).toBe("agent-1:workspace-a");
    expect(groups[1]?.entries[0]?.key).toBe("local-agent:local-workspace");
    expect(groups[2]?.entries[0]?.key).toBe("offline-agent:old");
  });

  it("shows unnamed sessions as disabled without ever producing a sessionID send key", () => {
    const groups = buildDirectoryGroups(
      [{ device: "dev", agentId: "agent-1", sessions: [{ sessionID: "raw-session" }] }],
      null,
      [],
    );
    const entry = groups[0]?.entries[0];

    expect(entry?.disabled).toBe(true);
    expect(entry?.key).toBeNull();
    expect(entry?.title).toBe("（未命名会话）");
  });
});

describe("searchConversationsAndAgents", () => {
  it("returns separate conversation and agent matches", () => {
    const result = searchConversationsAndAgents(
      "builder",
      [conversation("agent-2:other", "Builder", 100)],
      [
        {
          device: "builder-host",
          agentId: "agent-1",
          sessions: [{ sessionID: "raw", name: "workspace" }],
        },
      ],
    );

    expect(result.conversations.map((entry) => entry.peer.key)).toEqual(["agent-2:other"]);
    expect(result.agents.map((entry) => entry.key)).toEqual(["agent-1:workspace"]);
  });

  it("searches agent device and session names with canonical keys only", () => {
    const result = searchConversationsAndAgents("dev-laptop", [], peers);

    expect(result.agents).toHaveLength(2);
    expect(result.agents.every((entry) => entry.key?.startsWith("agent-1:"))).toBe(true);
  });
});

describe("moveDirectoryCursor", () => {
  it("moves through enabled entries and skips unnamed disabled sessions", async () => {
    const { moveDirectoryCursor } = await import("./wechat-model");
    const groups = buildDirectoryGroups(
      [
        {
          device: "dev",
          agentId: "agent-1",
          sessions: [
            { sessionID: "raw-1" },
            { sessionID: "raw-2", name: "one" },
            { sessionID: "raw-3", name: "two" },
          ],
        },
      ],
      null,
      [],
    );

    expect(moveDirectoryCursor(groups, null, 1)).toBe("agent-1:one");
    expect(moveDirectoryCursor(groups, "agent-1:one", 1)).toBe("agent-1:two");
    expect(moveDirectoryCursor(groups, "agent-1:two", 1)).toBe("agent-1:one");
    expect(moveDirectoryCursor(groups, "agent-1:one", -1)).toBe("agent-1:two");
  });
});
