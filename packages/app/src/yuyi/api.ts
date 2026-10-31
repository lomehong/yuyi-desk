/**
 * 御驿（Yuyi）daemon 读 API 客户端（fork M2c）。
 *
 * 数据面全部走 daemon 的 HTTP 端点（/api/yuyi/*）——客户端不直连 Hub，
 * 守「一设备一连接」收口原则。origin 解析仿 download-store：取主机的
 * directTcp 连接，ws→http 同源。鉴权：daemon 密码（Bearer）；无密码时省略。
 */
import type { HostProfile } from "@/types/host-connection";
import { buildDaemonWebSocketUrl } from "@/utils/daemon-endpoints";

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
  bindings: Array<{ name: string; paseoAgentId: string; title?: string | null }>;
}

export interface YuyiPeersEntry {
  device: string;
  role?: string;
  agentId?: string;
  sessions: Array<{ sessionID: string; name?: string; title?: string }>;
}

export interface YuyiInbox {
  bindings: Array<{
    name: string;
    recipientID: string;
    entries: Array<{ message: { id: string; text: string; from?: { name?: string } }; receivedAt: number }>;
    error?: string;
  }>;
}

export interface YuyiClient {
  origin: string | null;
  fetchStatus: () => Promise<YuyiStatus>;
  fetchPeers: () => Promise<YuyiPeersEntry[]>;
  fetchInbox: () => Promise<YuyiInbox>;
  ackInbox: (binding: string, ids: string[]) => Promise<{ ok: boolean; detail?: string }>;
}

async function request<T>(origin: string, path: string, init: RequestInit, bearer: string | null): Promise<T> {
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
  };
}
