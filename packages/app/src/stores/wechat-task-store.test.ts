import { describe, expect, it, vi } from "vitest";
import type { YuyiChatMessage, YuyiClient } from "@/yuyi/api";
import {
  broadcastTask,
  getTaskConversationSnapshot,
  refreshTaskConversation,
} from "./wechat-task-store";

function message(text: string): YuyiChatMessage {
  return { id: text, at: 1, dir: "out", text, taskId: "task_root" };
}

function fakeClient(text: string) {
  return {
    chats: {
      fetchTaskMessages: vi.fn(async (_root: string) => ({
        rootTaskId: _root,
        messages: [message(text)],
      })),
      fetchTask: vi.fn(async () => ({})),
      broadcastChat: vi.fn(async () => ({
        ok: false,
        delivery: "failed" as const,
        taskId: "task_root",
        detail: "denied",
      })),
    },
  } as unknown as YuyiClient;
}

describe("wechat task store", () => {
  it("partitions task snapshots by server and root", async () => {
    await refreshTaskConversation(fakeClient("host-a"), "host-a", "task_root");
    await refreshTaskConversation(fakeClient("host-b"), "host-b", "task_root");
    await refreshTaskConversation(fakeClient("other-root"), "host-a", "task_other");

    expect(getTaskConversationSnapshot("host-a", "task_root").messages[0]?.text).toBe("host-a");
    expect(getTaskConversationSnapshot("host-b", "task_root").messages[0]?.text).toBe("host-b");
    expect(getTaskConversationSnapshot("host-a", "task_other").messages[0]?.text).toBe(
      "other-root",
    );
  });

  it("does not let a stale response replace a newer task snapshot", async () => {
    let resolveOld!: (value: { rootTaskId: string; messages: YuyiChatMessage[] }) => void;
    const client = fakeClient("new");
    client.chats.fetchTaskMessages = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce({ rootTaskId: "task_root", messages: [message("new")] });
    const old = refreshTaskConversation(client, "host-race", "task_root");
    const current = refreshTaskConversation(client, "host-race", "task_root");
    resolveOld({ rootTaskId: "task_root", messages: [message("old")] });
    await Promise.all([old, current]);

    expect(getTaskConversationSnapshot("host-race", "task_root").messages[0]?.text).toBe("new");
  });

  it("does not insert an optimistic successful task when broadcast fails", async () => {
    const client = fakeClient("unused");
    const result = await broadcastTask(client, "host-failed", {
      title: "任务",
      text: "正文",
      taskId: "task_root",
    });

    expect(result.ok).toBe(false);
    expect(getTaskConversationSnapshot("host-failed", "task_root").messages).toEqual([]);
    expect(client.chats.fetchTaskMessages).not.toHaveBeenCalled();
  });
});
