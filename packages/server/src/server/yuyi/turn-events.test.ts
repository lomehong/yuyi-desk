import { describe, expect, test, vi } from "vitest";
import type { TurnStartedFrame } from "@qianji/protocol";
import { TurnEventProjection, runAgentTurn } from "./turn-events.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("runAgentTurn", () => {
  test("does not report started before the real run starts", async () => {
    const started = deferred();
    const events: string[] = [];
    const turn = runAgentTurn({
      waitForRunStart: () => started.promise,
      waitForFinish: async () => ({ lastMessage: "完成" }),
      sendStarted: async () => {
        events.push("started");
      },
      sendFinished: async (outcome) => {
        events.push(outcome);
      },
      sendReply: async () => ({ ok: true }),
    });
    await Promise.resolve();
    expect(events).toEqual([]);
    started.resolve();
    await turn;
    expect(events).toEqual(["started", "replied"]);
  });

  test("sends the real reply and reports replied", async () => {
    const sendReply = vi.fn(async (_text: string) => ({ ok: true }));
    const sendFinished = vi.fn(async (_outcome: string) => undefined);
    await runAgentTurn({
      waitForRunStart: async () => undefined,
      waitForFinish: async () => ({ lastMessage: "  真实结果  " }),
      sendStarted: async () => undefined,
      sendFinished,
      sendReply,
    });
    expect(sendReply).toHaveBeenCalledWith("真实结果");
    expect(sendFinished).toHaveBeenCalledWith("replied");
  });

  test("does not fabricate a reply when the run has no text", async () => {
    const sendReply = vi.fn(async (_text: string) => ({ ok: true }));
    const sendFinished = vi.fn(async (_outcome: string) => undefined);
    await runAgentTurn({
      waitForRunStart: async () => undefined,
      waitForFinish: async () => ({ lastMessage: "  " }),
      sendStarted: async () => undefined,
      sendFinished,
      sendReply,
    });
    expect(sendReply).not.toHaveBeenCalled();
    expect(sendFinished).toHaveBeenCalledWith("completed-without-reply");
  });

  test("reports waiting-permission without completing the task", async () => {
    const sendReply = vi.fn(async (_text: string) => ({ ok: true }));
    const sendFinished = vi.fn(async (_outcome: string) => undefined);
    await runAgentTurn({
      waitForRunStart: async () => undefined,
      waitForFinish: async () => ({
        permission: { id: "permission-1" },
        lastMessage: "不能当结果",
      }),
      sendStarted: async () => undefined,
      sendFinished,
      sendReply,
    });
    expect(sendReply).not.toHaveBeenCalled();
    expect(sendFinished).toHaveBeenCalledWith("waiting-permission");
  });

  test("reports failed when run start or reply fails", async () => {
    const sendStarted = vi.fn(async () => undefined);
    const sendFinished = vi.fn(async (_outcome: string) => undefined);
    await runAgentTurn({
      waitForRunStart: async () => {
        throw new Error("run missing");
      },
      waitForFinish: async () => ({ lastMessage: "不应执行" }),
      sendStarted,
      sendFinished,
      sendReply: async () => ({ ok: true }),
    });
    expect(sendStarted).not.toHaveBeenCalled();
    expect(sendFinished).toHaveBeenCalledWith("failed");

    sendFinished.mockClear();
    await runAgentTurn({
      waitForRunStart: async () => undefined,
      waitForFinish: async () => ({ lastMessage: "真实结果" }),
      sendStarted: async () => undefined,
      sendFinished,
      sendReply: async () => ({ ok: false, detail: "offline" }),
    });
    expect(sendFinished).toHaveBeenCalledWith("failed");
  });

  test("keeps executing when lifecycle reporting is unavailable", async () => {
    const sendReply = vi.fn(async (_text: string) => ({ ok: true }));
    const onReportError = vi.fn();
    await runAgentTurn({
      waitForRunStart: async () => undefined,
      waitForFinish: async () => ({ lastMessage: "仍然完成" }),
      sendStarted: async () => {
        throw new Error("old hub");
      },
      sendFinished: async () => {
        throw new Error("old hub");
      },
      sendReply,
      onReportError,
    });
    expect(sendReply).toHaveBeenCalledWith("仍然完成");
    expect(onReportError).toHaveBeenCalledTimes(2);
  });
});

describe("TurnEventProjection", () => {
  test("projects a Hub frame by replyTo and emits one detailed change", () => {
    const projection = new TurnEventProjection(() => 1234);
    const listener = vi.fn();
    projection.subscribe(listener);
    const frame: TurnStartedFrame = {
      type: "agent/turn-started",
      id: "turn-1",
      agentId: "agent-1",
      replyTo: "message-1",
      taskId: "task-1",
    };
    projection.apply(frame);
    expect(projection.get("message-1")).toEqual({
      replyTo: "message-1",
      agentId: "agent-1",
      taskId: "task-1",
      outcome: "started",
      at: 1234,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: "message-1", outcome: "started" }),
    );
  });
});
