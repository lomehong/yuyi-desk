import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { AgentPermissionRequest } from "../agent/agent-sdk-types.js";
import { respondToAgentPermission } from "../agent/permission-response.js";

export type DaemonApprovalState = "pending" | "approved" | "denied" | "expired";

export interface DaemonApproval {
  approvalId: string;
  agentId: string;
  fromAgentId?: string;
  requestId: string;
  summary: string;
  expiresAt: number;
  state: DaemonApprovalState;
  error?: string;
  note?: string;
  remote?: boolean;
}

interface ApprovalOptions {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
  knownSecrets: () => string[];
  now?: () => number;
  onChange?: (approval: DaemonApproval) => void;
}

export class DaemonApprovalService {
  private readonly records = new Map<string, DaemonApproval>();

  constructor(private readonly opts: ApprovalOptions) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private emit(record: DaemonApproval): void {
    this.opts.onChange?.({ ...record });
  }

  list(): DaemonApproval[] {
    // 逐条防御性复制（避免 map 内展开分配）
    const copies: DaemonApproval[] = [];
    for (const record of this.records.values()) copies.push({ ...record });
    return copies;
  }

  get(approvalId: string): DaemonApproval | undefined {
    const record = this.records.get(approvalId);
    return record ? { ...record } : undefined;
  }

  private summary(permission: AgentPermissionRequest): string {
    let summary = [permission.title, permission.description, permission.name]
      .filter((value): value is string => Boolean(value))
      .join(" · ");
    for (const secret of this.opts.knownSecrets()) {
      if (secret) summary = summary.replaceAll(secret, "[REDACTED]");
    }
    return summary.slice(0, 2_000);
  }

  async request(input: {
    agentId: string;
    fromAgentId?: string;
    permission: AgentPermissionRequest;
    expiresAt?: number;
    send: (input: {
      approvalId: string;
      summary: string;
      expiresAt: number;
    }) => Promise<{ ok: boolean; detail?: string }>;
  }): Promise<DaemonApproval> {
    const approvalId = `approval_${randomUUID()}`;
    const record: DaemonApproval = {
      approvalId,
      agentId: input.agentId,
      ...(input.fromAgentId ? { fromAgentId: input.fromAgentId } : {}),
      requestId: input.permission.id,
      summary: this.summary(input.permission),
      expiresAt: input.expiresAt ?? this.now() + 5 * 60_000,
      state: "pending",
    };
    this.records.set(approvalId, record);
    this.emit(record);
    const ack = await input.send({
      approvalId,
      summary: record.summary,
      expiresAt: record.expiresAt,
    });
    if (!ack.ok) {
      record.error = ack.detail ?? "approval request failed";
      this.emit(record);
    }
    return { ...record };
  }

  registerExternal(input: {
    approvalId: string;
    agentId: string;
    summary: string;
    expiresAt: number;
  }): DaemonApproval {
    const existing = this.records.get(input.approvalId);
    if (existing) return { ...existing };
    const record: DaemonApproval = {
      ...input,
      requestId: "",
      state: "pending",
      remote: true,
    };
    this.records.set(input.approvalId, record);
    this.emit(record);
    return { ...record };
  }

  markResolved(
    approvalId: string,
    decision: "approved" | "denied" | "expired",
    note?: string,
  ): DaemonApproval | undefined {
    const record = this.records.get(approvalId);
    if (!record || record.state !== "pending") return this.get(approvalId);
    record.state = decision;
    record.note = note;
    record.error = undefined;
    this.emit(record);
    return { ...record };
  }

  async applyResult(input: {
    approvalId: string;
    decision: "approved" | "denied";
    state?: DaemonApprovalState;
    note?: string;
  }): Promise<{ state: DaemonApprovalState; idempotent: boolean }> {
    const record = this.records.get(input.approvalId);
    if (!record) return { state: "expired", idempotent: true };
    if (record.state !== "pending") return { state: record.state, idempotent: true };
    if (input.state === "expired" || record.expiresAt <= this.now()) {
      record.state = "expired";
      this.emit(record);
      return { state: "expired", idempotent: false };
    }
    if (record.remote) {
      record.state = input.decision;
      record.note = input.note;
      this.emit(record);
      return { state: record.state, idempotent: false };
    }
    try {
      await respondToAgentPermission({
        agentManager: this.opts.agentManager,
        agentId: record.agentId,
        requestId: record.requestId,
        response:
          input.decision === "approved"
            ? { behavior: "allow" }
            : { behavior: "deny", ...(input.note ? { message: input.note } : {}) },
        logger: this.opts.logger,
      });
      record.state = input.decision;
      record.note = input.note;
      record.error = undefined;
      this.emit(record);
      return { state: record.state, idempotent: false };
    } catch (error) {
      record.error = String(error);
      this.opts.logger.warn(
        { err: error, approvalId: record.approvalId },
        "Yuyi approval resume failed",
      );
      this.emit(record);
      return { state: "pending", idempotent: false };
    }
  }
}
