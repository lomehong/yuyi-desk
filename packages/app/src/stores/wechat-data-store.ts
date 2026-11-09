import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useHosts } from "@/runtime/host-runtime";
import { useHostRouteServerId } from "@/navigation/host-route-context";
import {
  createYuyiClient,
  type YuyiChatEntry,
  type YuyiClient,
  type YuyiPeersEntry,
  type YuyiStatus,
  type YuyiTurnProjection,
} from "@/yuyi/api";
import { streamChatEvents, type YuyiChatEvent } from "@/yuyi/chat-events";

export interface WeChatDataSnapshot {
  conversations: YuyiChatEntry[];
  peers: YuyiPeersEntry[] | null;
  status: YuyiStatus | null;
  unread: number;
  error: string | null;
  loaded: boolean;
  eventRevision: number;
  eventPeerKey: string | null;
  turnsByReplyTo: Record<string, YuyiTurnProjection>;
}

const EMPTY_SNAPSHOT: WeChatDataSnapshot = {
  conversations: [],
  peers: null,
  status: null,
  unread: 0,
  error: null,
  loaded: false,
  eventRevision: 0,
  eventPeerKey: null,
  turnsByReplyTo: {},
};
const snapshots = new Map<string, WeChatDataSnapshot>();
const listeners = new Set<() => void>();
let activeClient: YuyiClient | null = null;
let activeKey: string | null = null;
let consumers = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;
let generation = 0;
let eventAbort: AbortController | null = null;
let eventActive = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshotFor(key: string): WeChatDataSnapshot {
  return snapshots.get(key) ?? EMPTY_SNAPSHOT;
}

export function getWeChatDataSnapshot(key: string): WeChatDataSnapshot {
  return snapshotFor(key);
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
  const key = activeKey;
  if (!client || !key) return;
  if (inflight) return inflight;
  const requestGeneration = generation;
  const request = (async () => {
    const [chatList, status, unread] = await Promise.allSettled([
      client.chats.fetchChatList(true),
      client.fetchStatus(),
      client.chats.fetchChatUnread(),
    ]);
    const peers =
      status.status === "fulfilled" && status.value.connected
        ? await Promise.allSettled([client.fetchPeers()])
        : null;
    if (requestGeneration !== generation || key !== activeKey) return;
    const previous = snapshotFor(key);
    const failed = [chatList, status, unread, ...(peers ?? [])].find(
      (result) => result.status === "rejected",
    );
    snapshots.set(key, {
      conversations: chatList.status === "fulfilled" ? chatList.value : previous.conversations,
      peers: resolvePeersSnapshot(peers, status, previous.peers),
      status: status.status === "fulfilled" ? status.value : previous.status,
      unread: unread.status === "fulfilled" ? unread.value : previous.unread,
      error: failed ? errorKey((failed as PromiseRejectedResult).reason) : null,
      loaded: true,
      eventRevision: previous.eventRevision,
      eventPeerKey: previous.eventPeerKey,
      turnsByReplyTo: previous.turnsByReplyTo,
    });
    emit();
  })();
  inflight = request;
  void request.finally(() => {
    if (inflight === request) inflight = null;
  });
  return request;
}

export function applyWeChatChatEvent(key: string, event: YuyiChatEvent): void {
  const previous = snapshotFor(key);
  let turnsByReplyTo = previous.turnsByReplyTo;
  if (event.kind === "turn-changed" && event.turn) {
    const turn = event.turn;
    const current = turnsByReplyTo[turn.replyTo];
    if (current?.at === turn.at && current.outcome === turn.outcome) return;
    const terminal =
      current && current.outcome !== "started" && current.outcome !== "waiting-permission";
    if (terminal && turn.outcome === "started") return;
    turnsByReplyTo = { ...turnsByReplyTo, [turn.replyTo]: { ...turn } };
  }
  snapshots.set(key, {
    ...previous,
    turnsByReplyTo,
    eventRevision: previous.eventRevision + 1,
    eventPeerKey: event.peerKey,
  });
  emit();
  if (key === activeKey) void refreshWeChatData();
}

function waitForEventRetry(signal: AbortSignal): Promise<void> {
  // 超时/中止各占一个 Promise（单一 resolve 位点），race 取先到者，finally 清理定时器
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<void>((resolve) => {
    retryTimer = setTimeout(() => resolve(), 5_000);
  });
  const aborted = new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
  return Promise.race([timeout, aborted]).finally(() => {
    if (retryTimer) clearTimeout(retryTimer);
  });
}

async function runEventStream(streamGeneration: number): Promise<void> {
  // 事件流重试循环：eventAbort/generation 是模块状态、循环体内不重赋值，退出条件由 body 内早返回承担
  for (;;) {
    const controller = eventAbort;
    if (!controller || controller.signal.aborted || streamGeneration !== generation) return;
    const client = activeClient;
    const key = activeKey;
    if (!client?.origin || !key) return;
    try {
      eventActive = true;
      await streamChatEvents({
        origin: client.origin,
        bearer: client.bearer,
        signal: controller.signal,
        onEvent: (event) => {
          if (streamGeneration === generation && key === activeKey)
            applyWeChatChatEvent(key, event);
        },
      });
      eventActive = false;
    } catch {
      eventActive = false;
    }
    if (controller.signal.aborted || streamGeneration !== generation) continue;
    await waitForEventRetry(controller.signal);
  }
}

function startEventStream(): void {
  if (eventAbort || !activeClient?.origin) return;
  eventAbort = new AbortController();
  void runEventStream(generation);
}

function schedule(delay?: number): void {
  if (timer || consumers <= 0) return;
  timer = setTimeout(
    () => {
      timer = null;
      if (document.visibilityState === "visible") {
        void refreshWeChatData().finally(() => schedule());
      } else {
        schedule(20_000);
      }
    },
    delay ?? (eventActive ? 60_000 : 5_000),
  );
}

function onFocus(): void {
  void refreshWeChatData().finally(() => schedule());
}

function onVisibilityChange(): void {
  if (document.visibilityState === "visible") onFocus();
}

function startPolling(): void {
  if (!timer) {
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    void refreshWeChatData().finally(() => schedule());
  }
  startEventStream();
}

function stopPolling(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  eventAbort?.abort();
  eventAbort = null;
  eventActive = false;
  window.removeEventListener("focus", onFocus);
  document.removeEventListener("visibilitychange", onVisibilityChange);
}

export function acquireWeChatData(client: YuyiClient, key: string): () => void {
  const hostChanged = activeKey !== key;
  if (hostChanged) {
    stopPolling();
    generation += 1;
    inflight = null;
    activeKey = key;
    activeClient = client;
  } else {
    activeClient = client;
  }
  consumers += 1;
  if (consumers === 1 || hostChanged) startPolling();
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
  const routeServerId = useHostRouteServerId();
  const effectiveServerId = serverId ?? routeServerId;
  const host = effectiveServerId
    ? hosts.find((item) => item.serverId === effectiveServerId)
    : hosts[0];
  const client = useMemo(() => (host ? createYuyiClient(host) : null), [host]);
  useEffect(() => {
    if (!client || !host) return;
    return acquireWeChatData(client, host.serverId);
  }, [client, host]);
  const key = host?.serverId ?? "";
  const data = useSyncExternalStore(subscribe, () => snapshotFor(key));
  const refresh = useCallback(() => refreshWeChatData(), []);
  return { ...data, refresh };
}

/** peers 快照解析（拆嵌套三元）：请求成功取值；daemon 断连时空列表；否则保留前值 */
function resolvePeersSnapshot(
  peers: PromiseSettledResult<YuyiPeersEntry[]>[] | null,
  status: PromiseSettledResult<{ connected: boolean }>,
  previous: YuyiPeersEntry[] | null,
): YuyiPeersEntry[] | null {
  if (peers?.[0]?.status === "fulfilled") return peers[0].value;
  if (status.status === "fulfilled" && !status.value.connected) return [];
  return previous;
}
