import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useHosts } from "@/runtime/host-runtime";
import { useHostRouteServerId } from "@/navigation/host-route-context";
import { createYuyiClient, type YuyiApproval, type YuyiClient } from "@/yuyi/api";
import { useWeChatData } from "./wechat-data-store";

const snapshots = new Map<string, YuyiApproval>();
const generations = new Map<string, number>();
const inflight = new Map<string, Promise<{ ok: boolean; detail?: string }>>();
const listeners = new Set<() => void>();
let approvalRevision = 0;

function keyFor(serverId: string, approvalId: string): string {
  return `${serverId}\0${approvalId}`;
}

function emit(): void {
  approvalRevision += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// 列表快照缓存：同一 (serverId, revision) 下引用稳定，避免每次读取都新建数组
let listCache: { serverId: string; revision: number; value: YuyiApproval[] } | null = null;

export function getApprovalSnapshot(
  serverId: string,
  approvalId: string,
): YuyiApproval | undefined {
  return snapshots.get(keyFor(serverId, approvalId));
}

export function listApprovalSnapshots(serverId: string): YuyiApproval[] {
  if (listCache && listCache.serverId === serverId && listCache.revision === approvalRevision) {
    return listCache.value;
  }
  const prefix = `${serverId}\0`;
  const value = [...snapshots.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, approval]) => approval)
    .sort((left, right) => right.expiresAt - left.expiresAt);
  listCache = { serverId, revision: approvalRevision, value };
  return value;
}

export async function refreshApprovals(client: YuyiClient, serverId: string): Promise<void> {
  const generation = (generations.get(serverId) ?? 0) + 1;
  generations.set(serverId, generation);
  if (!client.fetchApprovals) return;
  const result = await client.fetchApprovals();
  if (generations.get(serverId) !== generation) return;
  for (const approval of result.approvals) {
    snapshots.set(keyFor(serverId, approval.approvalId), { ...approval });
  }
  emit();
}

export async function resolveApproval(
  client: YuyiClient,
  serverId: string,
  approvalId: string,
  decision: "approved" | "denied",
  note?: string,
): Promise<{ ok: boolean; detail?: string }> {
  const key = keyFor(serverId, approvalId);
  const current = snapshots.get(key);
  if (!current || current.state !== "pending" || current.expiresAt <= Date.now()) {
    return { ok: false, detail: "approval missing or expired" };
  }
  const existing = inflight.get(key);
  if (existing) return existing;
  const request = (async () => {
    if (!client.resolveApproval) {
      const result = { ok: false, detail: "approval API unavailable" };
      snapshots.set(key, { ...current, error: result.detail });
      emit();
      return result;
    }
    const result = await client.resolveApproval({
      approvalId,
      decision,
      ...(note ? { note } : {}),
    });
    snapshots.set(
      key,
      result.ok
        ? {
            ...current,
            state: current.remote === true ? decision : "pending",
            note,
            error: undefined,
          }
        : { ...current, error: result.detail ?? "approval resolution failed" },
    );
    emit();
    return result;
  })();
  inflight.set(key, request);
  try {
    return await request;
  } finally {
    if (inflight.get(key) === request) inflight.delete(key);
  }
}

export function useApprovals(serverId?: string): {
  approvals: YuyiApproval[];
  refresh: () => Promise<void>;
  resolve: (
    approvalId: string,
    decision: "approved" | "denied",
    note?: string,
  ) => Promise<{ ok: boolean; detail?: string }>;
} {
  const hosts = useHosts();
  const routeServerId = useHostRouteServerId();
  const effectiveServerId = serverId ?? routeServerId;
  const host = effectiveServerId
    ? hosts.find((item) => item.serverId === effectiveServerId)
    : hosts[0];
  const client = useMemo(() => (host ? createYuyiClient(host) : null), [host]);
  const key = host?.serverId ?? "";
  const { eventRevision } = useWeChatData(key);
  // 订阅审批 store：emit() 后 getSnapshot 返回新数组引用（listApprovalSnapshots 内部按 revision 缓存）
  const approvals = useSyncExternalStore(subscribe, () => listApprovalSnapshots(key));
  const refresh = useCallback(async () => {
    if (client) await refreshApprovals(client, key);
  }, [client, key]);
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh, eventRevision]);
  const resolve = useCallback(
    (approvalId: string, decision: "approved" | "denied", note?: string) => {
      if (!client) return Promise.resolve({ ok: false, detail: "no http origin" });
      return resolveApproval(client, key, approvalId, decision, note);
    },
    [client, key],
  );
  return { approvals, refresh, resolve };
}

export function useApproval(
  approvalId: string | null,
  serverId?: string,
): YuyiApproval | undefined {
  const hosts = useHosts();
  const routeServerId = useHostRouteServerId();
  const effectiveServerId = serverId ?? routeServerId;
  const host = effectiveServerId
    ? hosts.find((item) => item.serverId === effectiveServerId)
    : hosts[0];
  useSyncExternalStore(subscribe, () =>
    approvalId ? getApprovalSnapshot(host?.serverId ?? "", approvalId) : undefined,
  );
  return approvalId ? getApprovalSnapshot(host?.serverId ?? "", approvalId) : undefined;
}
