import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationStore } from "./conversations.js";

const tempDirs: string[] = [];
process.env.YUYI_STATE_DIR = await mkdtemp(join(tmpdir(), "yuyi-broadcast-state-"));
tempDirs.push(process.env.YUYI_STATE_DIR);
const { YuyiService } = await import("./service.js");
const records = await import("@qianji/core/task-record");

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createService(
  options: { connected?: boolean; supported?: boolean; closed?: boolean } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "yuyi-broadcast-chat-"));
  tempDirs.push(dir);
  const logger = {
    child() {
      return this;
    },
    info() {},
    warn() {},
  };
  const service = new YuyiService({
    yuyiConfig: undefined,
    agentManager: {} as never,
    agentStorage: {} as never,
    logger: logger as never,
  });
  const sendFromOwner = vi.fn(async () => ({ ok: true, detail: "forwarded to 2 instance(s)" }));
  const link = {
    connected: options.connected ?? true,
    ownerBroadcastSupported: options.supported ?? true,
    sendFromOwner,
  };
  Object.assign(service as never, {
    link,
    cachedConfig: { device: "device-test" },
    chats: new ConversationStore(dir, () => undefined),
  });
  if (options.closed) {
    records.appendTaskRecord("task_closed", { kind: "created", taskId: "task_closed", owner: {} });
    records.closeTask("task_closed", "owner");
  }
  return { service, sendFromOwner };
}

describe("Owner task broadcast", () => {
  it("sends a real wildcard message and stores one task message", async () => {
    const { service, sendFromOwner } = await createService();
    const result = await service.broadcastAsOwner({
      title: "发布任务",
      text: "请协作处理",
      taskId: "task_root",
      parentTaskId: "task_parent",
      myName: "我",
    });

    expect(result).toMatchObject({ ok: true, taskId: "task_root", delivery: "delivered" });
    expect(sendFromOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        to: { target: "*" },
        taskId: "task_root",
        parentTaskId: "task_parent",
        text: "请协作处理",
      }),
    );
    expect(sendFromOwner.mock.calls[0][0].from).not.toHaveProperty("agentId");
    const messages = await service.taskMessages("task_root");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      dir: "out",
      text: "请协作处理",
      parentTaskId: "task_parent",
    });
  });

  it("fails clearly without an active connection or owner-broadcast support", async () => {
    const offline = await createService({ connected: false });
    expect(
      await offline.service.broadcastAsOwner({
        title: "任务",
        text: "正文",
        taskId: "task_offline",
      }),
    ).toMatchObject({
      ok: false,
      delivery: "failed",
    });
    expect(offline.sendFromOwner).not.toHaveBeenCalled();

    const oldHub = await createService({ supported: false });
    expect(
      await oldHub.service.broadcastAsOwner({ title: "任务", text: "正文", taskId: "task_old" }),
    ).toMatchObject({
      ok: false,
      delivery: "failed",
    });
    expect(oldHub.sendFromOwner).not.toHaveBeenCalled();
  });

  it("refuses to append or broadcast into a closed segment", async () => {
    const { service, sendFromOwner } = await createService({ closed: true });
    const result = await service.broadcastAsOwner({
      title: "任务",
      text: "正文",
      taskId: "task_closed",
    });
    expect(result).toMatchObject({ ok: false, delivery: "failed", taskId: "task_closed" });
    expect(sendFromOwner).not.toHaveBeenCalled();
    expect(await service.taskMessages("task_closed")).toEqual([]);
  });
});
