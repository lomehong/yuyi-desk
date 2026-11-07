import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useHosts } from "@/runtime/host-runtime";
import {
  createYuyiClient,
  type YuyiChatEntry,
  type YuyiClient,
  type YuyiPeersEntry,
  type YuyiStatus,
} from "@/yuyi/api";

export interface WeChatDataSnapshot {
  conversations: YuyiChatEntry[];
  peers: YuyiPeersEntry[] | null;
  status: YuyiStatus | null;
  unread: number;
  error: string | null;
}

let snapshot: WeChatDataSnapshot = {
  conversations: [],
  peers: null,
  status: null,
  unread: 0,
  error: null,
};
let activeClient: YuyiClient | null = null;
let activeKey: string | null = null;
let consumers = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;
let generation = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): WeChatDataSnapshot {
  return snapshot;
}

function errorKey(reason: unknown): string {
  const text = String(reason).toLowerCase();
  if (text.includes("401") || text.includes("403") || text.includes("unauthorized")) {
    return "wechat.errorUnauthorized";
  }
  if (text.includes("timeout") || text.includes("timed out")) return "wechat.errorTimeout";
  return "wechat.errorConnection";
}

export async function refreshWeChatData(): Promise<void> {
  const client = activeClient;
  if (!client) return;
  if (inflight) return inflight;
  const requestGeneration = generation;
  inflight = (async () => {
    const results = await Promise.allSettled([
      client.chats.fetchChatList(),
      client.fetchPeers(),
      client.fetchStatus(),
      client.chats.fetchChatUnread(),
    ]);
    if (requestGeneration !== generation) return;
    const failed = results.find((result) => result.status === "rejected");
    snapshot = {
      conversations: results[0].status === "fulfilled" ? results[0].value : snapshot.conversations,
      peers: results[1].status === "fulfilled" ? results[1].value : snapshot.peers,
      status: results[2].status === "fulfilled" ? results[2].value : snapshot.status,
      unread: results[3].status === "fulfilled" ? results[3].value : snapshot.unread,
      error: failed ? errorKey((failed as PromiseRejectedResult).reason) : null,
    };
    emit();
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

function schedule(delay = 5_000): void {
  if (timer || consumers <= 0) return;
  timer = setTimeout(() => {
    timer = null;
    if (document.visibilityState === "visible") {
      void refreshWeChatData().finally(() => schedule(5_000));
    } else {
      schedule(20_000);
    }
  }, delay);
}

function onFocus(): void {
  void refreshWeChatData().finally(() => schedule());
}

function onVisibilityChange(): void {
  if (document.visibilityState === "visible") onFocus();
}

function startPolling(): void {
  if (timer) return;
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibilityChange);
  void refreshWeChatData().finally(() => schedule());
}

function stopPolling(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  window.removeEventListener("focus", onFocus);
  document.removeEventListener("visibilitychange", onVisibilityChange);
}

export function acquireWeChatData(client: YuyiClient, key: string): () => void {
  if (activeKey !== key) {
    stopPolling();
    generation += 1;
    inflight = null;
    activeKey = key;
    activeClient = client;
    snapshot = { conversations: [], peers: null, status: null, unread: 0, error: null };
  } else {
    activeClient = client;
  }
  consumers += 1;
  if (consumers === 1) startPolling();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    consumers = Math.max(0, consumers - 1);
    if (consumers === 0) stopPolling();
  };
}

export function useWeChatData(serverId?: string): WeChatDataSnapshot & {
  refresh: () => Promise<void>;
} {
  const hosts = useHosts();
  const host = serverId ? hosts.find((item) => item.serverId === serverId) : hosts[0];
  const client = useMemo(() => (host ? createYuyiClient(host) : null), [host]);
  useEffect(() => {
    if (!client || !host) return;
    return acquireWeChatData(client, host.serverId);
  }, [client, host]);
  const data = useSyncExternalStore(subscribe, getSnapshot);
  const refresh = useCallback(() => refreshWeChatData(), []);
  return { ...data, refresh };
}
