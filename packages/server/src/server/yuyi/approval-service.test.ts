import { describe, expect, it, vi } from "vitest";
import { DaemonApprovalService } from "./approval-service.js";

function permission(id = "request-1") {
  return {
    id,
    provider: "omp" as const,
    kind: "tool" as const,
    name: "read_file",
    title: "读取工作区",
    description: "允许读取 token=secret-value",
  };
}

function setup(now = 1_000) {
  const manager = { respondToPermission: vi.fn(async () => undefined) };
  const logger = {
    child() {
      return this;
    },
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
  const changes: unknown[] = [];
  const service = new DaemonApprovalService({
    agentManager: manager as never,
    agentStorage: {} as never,
    logger: logger as never,
    knownSecrets: () => ["secret-value"],
    now: () => now,
    onChange: (approval) => changes.push(approval),
  });
  return { service, manager, changes };
}

describe("DaemonApprovalService", () => {
  it("resumes an approved permission once and makes replay idempotent", async () => {
    const { service, manager } = setup();
    const created = await service.request({
      agentId: "agent-1",
      permission: permission(),
      send: async () => ({ ok: true }),
    });
    const first = await service.applyResult({
      approvalId: created.approvalId,
      decision: "approved",
    });
    expect(first.state).toBe("approved");
    expect(manager.respondToPermission).toHaveBeenCalledWith("agent-1", "request-1", {
      behavior: "allow",
    });
    await service.applyResult({ approvalId: created.approvalId, decision: "denied" });
    expect(manager.respondToPermission).toHaveBeenCalledTimes(1);
  });

  it("denies through the real permission response path", async () => {
    const { service, manager } = setup();
    const created = await service.request({
      agentId: "agent-1",
      permission: permission(),
      send: async () => ({ ok: true }),
    });
    await service.applyResult({
      approvalId: created.approvalId,
      decision: "denied",
      note: "不允许",
    });
    expect(manager.respondToPermission).toHaveBeenCalledWith("agent-1", "request-1", {
      behavior: "deny",
      message: "不允许",
    });
  });

  it("never resumes expired or unknown approvals", async () => {
    const { service, manager } = setup(2_001);
    const created = await service.request({
      agentId: "agent-1",
      permission: permission(),
      expiresAt: 2_000,
      send: async () => ({ ok: true }),
    });
    expect(
      (await service.applyResult({ approvalId: created.approvalId, decision: "approved" })).state,
    ).toBe("expired");
    expect((await service.applyResult({ approvalId: "unknown", decision: "approved" })).state).toBe(
      "expired",
    );
    expect(manager.respondToPermission).not.toHaveBeenCalled();
  });

  it("redacts known secrets and bounds the summary", async () => {
    const { service } = setup();
    let outbound = "";
    const created = await service.request({
      agentId: "agent-1",
      permission: { ...permission(), description: `token=secret-value ${"x".repeat(2_100)}` },
      send: async (input) => {
        outbound = input.summary;
        return { ok: true };
      },
    });
    expect(outbound).not.toContain("secret-value");
    expect(outbound.length).toBeLessThanOrEqual(2_000);
    expect(created.summary).toBe(outbound);
  });

  it("keeps permission recovery pending when the manager fails", async () => {
    const { service, manager } = setup();
    manager.respondToPermission.mockRejectedValue(new Error("resume failed"));
    const created = await service.request({
      agentId: "agent-1",
      permission: permission(),
      send: async () => ({ ok: true }),
    });
    const result = await service.applyResult({
      approvalId: created.approvalId,
      decision: "approved",
    });
    expect(result.state).toBe("pending");
    expect(service.get(created.approvalId)?.error).toContain("resume failed");
  });
});
