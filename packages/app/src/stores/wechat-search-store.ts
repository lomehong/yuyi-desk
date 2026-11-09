import { useEffect, useMemo, useState } from "react";
import { useHostRouteServerId } from "@/navigation/host-route-context";
import { useHosts } from "@/runtime/host-runtime";
import { createYuyiClient, type YuyiChatEntry, type YuyiChatMessage } from "@/yuyi/api";

export interface WeChatMessageSearchResult {
  peer: YuyiChatEntry["peer"];
  message: YuyiChatMessage;
  summary: string;
  archived: boolean;
}

export interface WeChatSearchSnapshot {
  results: WeChatMessageSearchResult[];
  loading: boolean;
  error: string | null;
}

const EMPTY: WeChatSearchSnapshot = { results: [], loading: false, error: null };
const snapshots = new Map<string, WeChatSearchSnapshot>();

export function useWeChatMessageSearch(
  serverId: string | undefined,
  query: string,
): WeChatSearchSnapshot {
  const hosts = useHosts();
  const routeServerId = useHostRouteServerId();
  const effectiveServerId = serverId ?? routeServerId;
  const host = effectiveServerId
    ? hosts.find((item) => item.serverId === effectiveServerId)
    : hosts[0];
  const client = useMemo(() => (host ? createYuyiClient(host) : null), [host]);
  const hostKey = host?.serverId ?? "";
  const normalized = query.trim();
  const snapshotKey = `${hostKey}:${normalized}`;
  const [snapshot, setSnapshot] = useState<WeChatSearchSnapshot>(
    () => snapshots.get(snapshotKey) ?? EMPTY,
  );

  useEffect(() => {
    if (!normalized) {
      snapshots.delete(snapshotKey);
      setSnapshot(EMPTY);
      return;
    }
    const previous = snapshots.get(snapshotKey) ?? EMPTY;
    const loading = { ...previous, loading: true, error: null };
    setSnapshot(loading);
    if (!client) {
      setSnapshot({ ...previous, loading: false, error: "wechat.errorConnection" });
      return;
    }
    let cancelled = false;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      // async/await 承接结果与失败（等价于 then/catch，避免在 promise 回调里同步回调 setState）
      void (async () => {
        try {
          const response = await client.chats.searchChatMessages(normalized, {
            includeArchived: true,
            limit: 50,
            signal: abort.signal,
          });
          if (cancelled) return;
          const next = { results: response.results, loading: false, error: null };
          snapshots.set(snapshotKey, next);
          setSnapshot(next);
        } catch (error: unknown) {
          if (cancelled || abort.signal.aborted) return;
          const next = {
            ...previous,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          };
          snapshots.set(snapshotKey, next);
          setSnapshot(next);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      abort.abort();
    };
  }, [client, hostKey, normalized, snapshotKey]);

  return snapshot;
}
