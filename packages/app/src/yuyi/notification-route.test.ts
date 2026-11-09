import { describe, expect, it } from "vitest";
import { resolveNotificationPeer, resolveNotificationTarget } from "./notification-route";

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

  it("routes a task notification to the task root instead of an Agent target", () => {
    expect(
      resolveNotificationTarget("task:task_root", [
        {
          peer: { key: "task:task_root", title: "协作任务", kind: "task" },
          lastAt: 1,
          lastText: "broadcast",
          unread: 1,
        },
      ]),
    ).toEqual({ type: "task", rootTaskId: "task_root", title: "协作任务" });
  });

  it("routes an approval notification by approvalId without inventing a peer", () => {
    expect(resolveNotificationTarget("approval:approval-1", [])).toEqual({
      type: "approval",
      approvalId: "approval-1",
    });
  });
});
