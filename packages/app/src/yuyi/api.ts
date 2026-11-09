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
  peer: { key: string; title: string; kind: "owner" | "agent" | "observe" | "task"; role?: string };
  lastAt: number;
  lastText: string;
  unread: number;
  archivedAt?: number;
  pinnedAt?: number;
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
  /** 真实注入事件等系统行 */
  kind?: "system";
  /** 协议引用链（结果卡引用行；历史消息无此字段不渲染） */
  replyTo?: string;
  /** 任务段 id（旁观回合分组；无则归「未关联任务」） */
  taskId?: string;
  parentTaskId?: string;
}

export interface OwnerBroadcastResult {
  ok: boolean;
  delivery: "injected" | "mailed" | "delivered" | "failed";
  messageId?: string;
  taskId: string;
  detail?: string;
}

export interface YuyiTaskIndex {
  taskId: string;
  rootTaskId?: string;
  participants: string[];
  messageCount: number;
  firstAt: number;
  lastAt: number;
  segments?: Array<{
    taskId: string;
    parentTaskId?: string;
    messageCount: number;
    firstAt: number;
    lastAt: number;
  }>;
}

export type YuyiTurnOutcome =
  | "started"
  | "replied"
  | "completed-without-reply"
  | "failed"
  | "waiting-permission";

export interface YuyiTurnProjection {
  replyTo: string;
  agentId: string;
  taskId?: string;
  outcome: YuyiTurnOutcome;
  at: number;
}

export interface YuyiApproval {
  approvalId: string;
  agentId: string;
  fromAgentId?: string;
  requestId: string;
  summary: string;
  expiresAt: number;
  state: "pending" | "approved" | "denied" | "expired";
  error?: string;
  note?: string;
  remote?: boolean;
}

export interface YuyiChatSearchResult {
  peer: YuyiChatEntry["peer"];
  message: YuyiChatMessage;
  summary: string;
  archived: boolean;
}

export interface YuyiChatClient {
  fetchChatList: (includeArchived?: boolean) => Promise<YuyiChatEntry[]>;
  fetchChatHistory: (
    peerKey: string,
    tail?: number,
    around?: string,
  ) => Promise<{ peerKey: string; messages: YuyiChatMessage[] }>;
  searchChatMessages: (
    query: string,
    options: { includeArchived?: boolean; limit?: number; signal?: AbortSignal },
  ) => Promise<{ results: YuyiChatSearchResult[] }>;
  setChatArchived: (peerKey: string, archived: boolean) => Promise<void>;
  setChatPinned: (peerKey: string, pinned: boolean) => Promise<void>;
  deleteChat: (peerKey: string) => Promise<void>;
  fetchTask?: (taskId: string) => Promise<{ task?: YuyiTaskIndex }>;
  fetchTaskMessages?: (
    rootTaskId: string,
  ) => Promise<{ rootTaskId: string; messages: YuyiChatMessage[] }>;
  broadcastChat?: (input: {
    title: string;
    text: string;
    taskId: string;
    parentTaskId?: string;
    myName?: string;
  }) => Promise<OwnerBroadcastResult>;
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
  /** 显式清未读（P1；history 仍有隐式清读兜底） */
  markChatRead: (peerKey: string) => Promise<void>;
  /** 旁观静音持久化（App 与 daemon 同步；不删除消息） */
  setChatMuted: (peerKey: string, muted: boolean) => Promise<void>;
  /** 会话页聚焦抑制（滑动 TTL，桌面通知静默） */
  notifySuppress: (peerKey: string, ttlMs?: number) => Promise<void>;
}

export interface YuyiAgentLocation {
  found: boolean;
  agentId?: string;
  paseoAgentId?: string;
  workspaceId?: string;
  cwd?: string;
  title?: string | null;
}

export interface YuyiClient {
  origin: string | null;
  bearer: string | null;
  locateAgent: (name: string) => Promise<YuyiAgentLocation>;
  fetchStatus: () => Promise<YuyiStatus>;
  fetchPeers: () => Promise<YuyiPeersEntry[]>;
  fetchInbox: () => Promise<YuyiInbox>;
  ackInbox: (binding: string, ids: string[]) => Promise<{ ok: boolean; detail?: string }>;
  fetchApprovals?: () => Promise<{ approvals: YuyiApproval[] }>;
  resolveApproval?: (input: {
    approvalId: string;
    decision: "approved" | "denied";
    note?: string;
  }) => Promise<{ ok: boolean; detail?: string }>;
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
    bearer,
    locateAgent: (name) => {
      if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
      return request<YuyiAgentLocation>(
        origin,
        `/api/yuyi/agent-locate?name=${encodeURIComponent(name)}`,
        {},
        bearer,
      );
    },
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
    fetchApprovals: () => {
      if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
      return request<{ approvals: YuyiApproval[] }>(origin, "/api/yuyi/approvals", {}, bearer);
    },
    resolveApproval: (input) => {
      if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
      return request<{ ok: boolean; detail?: string }>(
        origin,
        "/api/yuyi/approval/resolve",
        { method: "POST", body: JSON.stringify(input) },
        bearer,
      );
    },
    // 「Agent 微信」M1：Owner 直发 + 会话面（daemon /api/yuyi/chat/*）
    chats: {
      fetchChatList: (includeArchived = false) => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        return request<{ conversations: YuyiChatEntry[] }>(
          origin,
          `/api/yuyi/chat/list${includeArchived ? "?includeArchived=true" : ""}`,
          {},
          bearer,
        ).then((r) => r.conversations);
      },
      fetchChatHistory: (peerKey, tail, around) => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        const params = new URLSearchParams({ peer: peerKey });
        if (tail) params.set("tail", String(tail));
        if (around) params.set("around", around);
        return request<{ peerKey: string; messages: YuyiChatMessage[] }>(
          origin,
          `/api/yuyi/chat/history?${params}`,
          {},
          bearer,
        );
      },
      searchChatMessages: (query, options) => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        const params = new URLSearchParams({ q: query });
        if (options.includeArchived) params.set("includeArchived", "true");
        if (options.limit) params.set("limit", String(options.limit));
        return request<{ results: YuyiChatSearchResult[] }>(
          origin,
          `/api/yuyi/chat/search?${params}`,
          { signal: options.signal },
          bearer,
        );
      },
      setChatArchived: (peerKey, archived) => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        return request<{ ok: boolean }>(
          origin,
          "/api/yuyi/chat/archive",
          { method: "POST", body: JSON.stringify({ peerKey, archived }) },
          bearer,
        ).then(() => undefined);
      },
      setChatPinned: (peerKey, pinned) => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        return request<{ ok: boolean }>(
          origin,
          "/api/yuyi/chat/pin",
          { method: "POST", body: JSON.stringify({ peerKey, pinned }) },
          bearer,
        ).then(() => undefined);
      },
      deleteChat: (peerKey) => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        return request<{ ok: boolean }>(
          origin,
          `/api/yuyi/chat?peer=${encodeURIComponent(peerKey)}`,
          { method: "DELETE" },
          bearer,
        ).then(() => undefined);
      },
      fetchTask: (taskId) => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        return request<{ task?: YuyiTaskIndex }>(
          origin,
          `/api/yuyi/task?taskId=${encodeURIComponent(taskId)}`,
          {},
          bearer,
        );
      },
      fetchTaskMessages: (rootTaskId) => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        return request<{ rootTaskId: string; messages: YuyiChatMessage[] }>(
          origin,
          `/api/yuyi/task/messages?root=${encodeURIComponent(rootTaskId)}`,
          {},
          bearer,
        );
      },
      broadcastChat: (input) => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        return request<OwnerBroadcastResult>(
          origin,
          "/api/yuyi/chat/broadcast",
          { method: "POST", body: JSON.stringify(input) },
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
      markChatRead: (peerKey) => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        return request<{ ok: boolean }>(
          origin,
          "/api/yuyi/chat/mark-read",
          { method: "POST", body: JSON.stringify({ peerKey }) },
          bearer,
        ).then(() => undefined);
      },
      setChatMuted: (peerKey, muted) => {
        if (!origin) return Promise.reject(new YuyiApiError("no http origin", 0));
        return request<{ ok: boolean }>(
          origin,
          "/api/yuyi/chat/mute",
          { method: "POST", body: JSON.stringify({ peerKey, muted }) },
          bearer,
        ).then(() => undefined);
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
