/**
 * 御驿（Yuyi）daemon 读 API 客户端（fork M2c）。
 *
 * 数据面全部走 daemon 的 HTTP 端点（/api/yuyi/*）——客户端不直连 Hub，
 * 守「一设备一连接」收口原则。origin 解析仿 download-store：取主机的
 * directTcp 连接，ws→http 同源。鉴权：daemon 密码（Bearer）；无密码时省略。
 */
import type { HostProfile } from "@/types/host-connection";
import { buildDaemonWebSocketUrl } from "@/utils/daemon-endpoints";
import type { DeliveryAck } from "@/yuyi/delivery-states";

/** 解析主机的 daemon HTTP origin（仅 directTcp 连接有 HTTP 通道） */
export function resolveYuyiHttpOrigin(host: HostProfile): string | null {
  const connection = host.connections.find((conn) => conn.type === "directTcp");
  if (!connection || connection.type !== "directTcp") {
    return null;
  }
  let url: URL;
  try {
    url = new URL(
      buildDaemonWebSocketUrl(connection.endpoint, { useTls: connection.useTls ?? false }),
    );
  } catch {
    return null;
  }
  url.protocol = url.protocol === "ws:" ? "http:" : "https:";
  url.username = "";
  url.password = "";
  url.pathname = "/";
  return url.origin;
}

export class YuyiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface YuyiStatus {
  connected: boolean;
  hub: string;
  device: string;
  principal: "device" | "agent" | null;
  bindings: Array<{
    name: string;
    agentId?: string;
    paseoAgentId: string;
    title?: string | null;
  }>;
}

export interface YuyiPeersEntry {
  device: string;
  role?: string;
  agentId?: string;
  /** 工作现场（Hub P1-7 透传，对端 opt-in；缺失=诚实降级不显示） */
  activity?: { busy?: boolean; doing?: string; repo?: string };
  sessions: Array<{ sessionID: string; name?: string; title?: string }>;
}

export interface YuyiInbox {
  bindings: Array<{
    name: string;
    recipientID: string;
    entries: Array<{
      message: { id: string; text: string; from?: { name?: string } };
      receivedAt: number;
    }>;
    error?: string;
  }>;
}

/** 「Agent 微信」M1：会话条目（daemon conversations.json 索引） */
export interface YuyiChatEntry {
  peer: { key: string; title: string; kind: "owner" | "agent" | "observe"; role?: string };
  lastAt: number;
  lastText: string;
  unread: number;
  /** 末条方向（列表行「我:」前缀与状态微标用） */
  lastDir?: "out" | "in";
  /** 末条出向投递快照（状态微标：处理中/失败等） */
  lastAck?: { ok: boolean; detail?: string };
}

/** 会话消息（本地流水） */
export interface YuyiChatMessage {
  id: string;
  at: number;
  dir: "out" | "in";
  text: string;
  from?: {
    name?: string;
    device?: string;
    role?: string;
    agentId?: string;
    ownerUsername?: string;
  };
  hubId?: string;
  ack?: DeliveryAck;
  /** 本地 ack 时间（乐观消息；用于 S1 计时） */
  ackAt?: number;
  /** 协议引用链（结果卡引用行；历史消息无此字段不渲染） */
  replyTo?: string;
  /** 任务段 id（旁观回合分组；无则归「未关联任务」） */
  taskId?: string;
}

export interface YuyiChatClient {
  fetchChatList: () => Promise<YuyiChatEntry[]>;
  fetchChatHistory: (
    peerKey: string,
    tail?: number,
  ) => Promise<{ peerKey: string; messages: YuyiChatMessage[] }>;
  sendChat: (
    to: string,
    text: string,
    myName?: string,
  ) => Promise<{
    ok: boolean;
    detail?: string;
    /** 结构化投递分类（daemon 侧一次判定，替代 detail 字符串猜测） */
    delivery?: "injected" | "mailed" | "delivered" | "failed";
    /** 本地流水 id（乐观气泡与 history 对账键） */
    messageId?: string;
  }>;
  fetchChatUnread: () => Promise<number>;
  /** 只读预览（不 markRead；通知桥/乐观对账高频专用） */
  fetchChatPreview: (
    peerKey: string,
    sinceTs?: number,
  ) => Promise<{ peerKey: string; messages: YuyiChatMessage[] }>;
  /** 对端「处理中」真实信号（本机 agent 可知；远端 busy=null 未知） */
  fetchChatTurns: (peerKey: string) => Promise<{ peerKey: string; busy: boolean | null }>;
  /** 会话页聚焦抑制（滑动 TTL，桌面通知静默） */
  notifySuppress: (peerKey: string, ttlMs?: number) => Promise<void>;
}

export interface YuyiClient {
  origin: string | null;
  fetchStatus: () => Promise<YuyiStatus>;
  fetchPeers: () => Promise<YuyiPeersEntry[]>;
  fetchInbox: () => Promise<YuyiInbox>;
  ackInbox: (binding: string, ids: string[]) => Promise<{ ok: boolean; detail?: string }>;
  chats: YuyiChatClient;
}

async function request<T>(
  origin: string,
  path: string,
  init: RequestInit,
  bearer: string | null,
): Promise<T> {
  const res = await fetch(new URL(path, origin), {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // keep HTTP status detail
    }
    throw new YuyiApiError(detail, res.status);
  }
  return (await res.json()) as T;
}

export function createYuyiClient(host: HostProfile): YuyiClient {
  const origin = resolveYuyiHttpOrigin(host);
  const bearer = host.password ? host.password : null;
  return {
    origin,
    fetchStatus: () => {
      if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
      return request<YuyiStatus>(origin, "/api/yuyi/status", {}, bearer);
    },
    fetchPeers: () => {
      if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
      return request<YuyiPeersEntry[]>(origin, "/api/yuyi/peers", {}, bearer);
    },
    fetchInbox: () => {
      if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
      return request<YuyiInbox>(origin, "/api/yuyi/inbox", {}, bearer);
    },
    ackInbox: (binding, ids) => {
      if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
      return request<{ ok: boolean; detail?: string }>(
        origin,
        "/api/yuyi/inbox/ack",
        { method: "POST", body: JSON.stringify({ binding, ids }) },
        bearer,
      );
    },
    // 「Agent 微信」M1：Owner 直发 + 会话面（daemon /api/yuyi/chat/*）
    chats: {
      fetchChatList: () => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        return request<{ conversations: YuyiChatEntry[] }>(
          origin,
          "/api/yuyi/chat/list",
          {},
          bearer,
        ).then((r) => r.conversations);
      },
      fetchChatHistory: (peerKey, tail) => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        const q = tail ? `?tail=${tail}` : "";
        return request<{ peerKey: string; messages: YuyiChatMessage[] }>(
          origin,
          `/api/yuyi/chat/history?peer=${encodeURIComponent(peerKey)}${q}`,
          {},
          bearer,
        );
      },
      sendChat: (to, text, myName) => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        return request<{ ok: boolean; detail?: string }>(
          origin,
          "/api/yuyi/chat/send",
          { method: "POST", body: JSON.stringify({ to, text, myName }) },
          bearer,
        );
      },
      fetchChatUnread: () => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        return request<{ unread: number }>(origin, "/api/yuyi/chat/unread", {}, bearer).then(
          (r) => r.unread,
        );
      },
      // UI v2 状态反馈：只读预览（不 markRead，高频专用）
      fetchChatPreview: (peerKey, sinceTs) => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        const q = sinceTs ? `&since=${sinceTs}` : "";
        return request<{ peerKey: string; messages: YuyiChatMessage[] }>(
          origin,
          `/api/yuyi/chat/preview?peer=${encodeURIComponent(peerKey)}${q}`,
          {},
          bearer,
        );
      },
      // UI v2 状态机 S1 佐证：对端真实忙碌（本机 agent 可知，远端 null 未知）
      fetchChatTurns: (peerKey) => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        return request<{ peerKey: string; busy: boolean | null }>(
          origin,
          `/api/yuyi/chat/turns?peer=${encodeURIComponent(peerKey)}`,
          {},
          bearer,
        );
      },
      // UI v2 聚焦抑制：会话页打开时静默该会话桌面通知（滑动 TTL）
      notifySuppress: (peerKey, ttlMs = 5000) => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        return request<{ ok: boolean }>(
          origin,
          "/api/yuyi/chat/notify-suppress",
          { method: "POST", body: JSON.stringify({ peerKey, ttlMs }) },
          bearer,
        ).then(() => undefined);
      },
    },
  };
}
