import { describe, expect, it, vi } from "vitest";
import type { YuyiApproval, YuyiClient } from "@/yuyi/api";
import { getApprovalSnapshot, refreshApprovals, resolveApproval } from "./wechat-approval-store";

function approval(overrides: Partial<YuyiApproval> = {}): YuyiApproval {
  return {
    approvalId: "approval-1",
    agentId: "agent-1",
    requestId: "request-1",
    summary: "读取工作区",
    expiresAt: Date.now() + 60_000,
    state: "pending",
    ...overrides,
  };
}

function fakeClient(overrides: Partial<YuyiApproval> = {}) {
  return {
    fetchApprovals: vi.fn(async () => ({ approvals: [approval(overrides)] })),
    resolveApproval: vi.fn(async () => ({ ok: true })),
  } as unknown as YuyiClient;
}

describe("wechat approval store", () => {
  it("loads approvals by host", async () => {
    await refreshApprovals(fakeClient(), "host-a");
    await refreshApprovals(fakeClient({ agentId: "agent-b" }), "host-b");
    expect(getApprovalSnapshot("host-a", "approval-1")?.agentId).toBe("agent-1");
    expect(getApprovalSnapshot("host-b", "approval-1")?.agentId).toBe("agent-b");
  });

  it("sends only one resolution for concurrent double clicks", async () => {
    const client = fakeClient({ remote: true });
    await refreshApprovals(client, "host-double");
    const first = resolveApproval(client, "host-double", "approval-1", "approved");
    const second = resolveApproval(client, "host-double", "approval-1", "approved");
    await Promise.all([first, second]);
    expect(client.resolveApproval).toHaveBeenCalledTimes(1);
    expect(getApprovalSnapshot("host-double", "approval-1")?.state).toBe("approved");
  });

  it("keeps pending and the real error when resolution fails", async () => {
    const client = fakeClient();
    client.resolveApproval = vi.fn(async () => ({ ok: false, detail: "unsupported" }));
    await refreshApprovals(client, "host-failure");
    await resolveApproval(client, "host-failure", "approval-1", "denied");
    expect(getApprovalSnapshot("host-failure", "approval-1")?.state).toBe("pending");
    expect(getApprovalSnapshot("host-failure", "approval-1")?.error).toBe("unsupported");
  });

  it("keeps a local permission pending until the real result arrives", async () => {
    const client = fakeClient();
    await refreshApprovals(client, "host-local");
    await resolveApproval(client, "host-local", "approval-1", "approved");
    expect(getApprovalSnapshot("host-local", "approval-1")?.state).toBe("pending");
  });

  it("never sends a resolution for an expired approval", async () => {
    const client = fakeClient({ expiresAt: Date.now() - 1 });
    await refreshApprovals(client, "host-expired");
    const result = await resolveApproval(client, "host-expired", "approval-1", "approved");
    expect(result.ok).toBe(false);
    expect(client.resolveApproval).not.toHaveBeenCalled();
  });
});
