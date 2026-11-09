import { describe, expect, it, vi } from "vitest";
import type { YuyiBinding } from "./link.js";

vi.mock("../agent/agent-prompt.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../agent/agent-prompt.js")>();
  return { ...original, waitForAgentRunStartWithTimeout: vi.fn(async () => undefined) };
});

const { YuyiService } = await import("./service.js");

const binding: YuyiBinding = {
  agentId: "canonical-agent-1",
  name: "worker",
  token: "secret",
  paseoAgentId: "agent-1",
  sessions: [],
};

function permission() {
  return {
    id: "request-1",
    provider: "omp" as const,
    kind: "tool" as const,
    name: "read_file",
    title: "读取工作区",
  };
}

function setup(waitResult: unknown = { status: "permission", permission: permission() }) {
  const manager = {
    waitForAgentEvent: vi.fn(async () => waitResult),
    respondToPermission: vi.fn(async () => undefined),
  };
  const logger = {
    child() {
      return this;
    },
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
  const service = new YuyiService({
    yuyiConfig: undefined,
    agentManager: manager as never,
    agentStorage: {} as never,
    logger: logger as never,
  });
  const link = {
    sendTurnStarted: vi.fn(async () => undefined),
    sendTurnFinished: vi.fn(async () => undefined),
    requestApproval: vi.fn(async () => ({ ok: true })),
    sendFromBinding: vi.fn(async () => ({ ok: true })),
  };
  Object.assign(service as never, { link, cachedConfig: { device: "device-a", agents: [] } });
  return { service, manager, link };
}

async function startApproval(service: InstanceType<typeof YuyiService>) {
  await (
    service as never as {
      autoReply: (binding: YuyiBinding, message: unknown) => Promise<void>;
    }
  ).autoReply(binding, {
    id: "message-1",
    mode: "notify",
    text: "请处理",
    from: { device: "owner-device", sessionID: "owner", name: "Owner" },
    to: { target: "worker" },
    time: 1,
    taskId: "task-1",
    expectReply: true,
  });
  const approvals = (
    service as never as {
      approvals: { list: () => Array<{ approvalId: string }> };
    }
  ).approvals.list();
  return approvals[0]?.approvalId ?? "";
}

describe("controlled approval flow", () => {
  it("completes permission wait → request → approve → resume exactly once", async () => {
    const { service, manager } = setup();
    const approvalId = await startApproval(service);
    expect(approvalId).toBeTruthy();
    const approvals = (
      service as never as {
        approvals: {
          applyResult: (input: {
            approvalId: string;
            decision: "approved" | "denied";
          }) => Promise<unknown>;
        };
      }
    ).approvals;
    await approvals.applyResult({ approvalId, decision: "approved" });
    await approvals.applyResult({ approvalId, decision: "approved" });
    expect(manager.respondToPermission).toHaveBeenCalledTimes(1);
    expect(manager.respondToPermission).toHaveBeenCalledWith("agent-1", "request-1", {
      behavior: "allow",
    });
  });

  it("uses the deny response path", async () => {
    const { service, manager } = setup();
    const approvalId = await startApproval(service);
    await (
      service as never as {
        approvals: { applyResult: (input: unknown) => Promise<unknown> };
      }
    ).approvals.applyResult({ approvalId, decision: "denied", note: "不允许" });
    expect(manager.respondToPermission).toHaveBeenCalledWith("agent-1", "request-1", {
      behavior: "deny",
      message: "不允许",
    });
  });

  it("does not resume expired or unknown approvals", async () => {
    const { service, manager } = setup();
    const approvalId = await startApproval(service);
    const approvals = (
      service as never as {
        approvals: {
          records: Map<string, { expiresAt: number }>;
          applyResult: (input: unknown) => Promise<unknown>;
        };
      }
    ).approvals;
    const record = approvals.records.get(approvalId)!;
    record.expiresAt = 0;
    await approvals.applyResult({ approvalId, decision: "approved" });
    await approvals.applyResult({ approvalId: "unknown", decision: "approved" });
    expect(manager.respondToPermission).not.toHaveBeenCalled();
  });

  it("does not create an approval for an ordinary reply", async () => {
    const { service, manager, link } = setup({ status: "idle", lastMessage: "普通回信" });
    await startApproval(service);
    expect(manager.respondToPermission).not.toHaveBeenCalled();
    expect(link.sendFromBinding).toHaveBeenCalled();
    expect((service as never as { approvals: { list: () => unknown[] } }).approvals.list()).toEqual(
      [],
    );
  });
});
