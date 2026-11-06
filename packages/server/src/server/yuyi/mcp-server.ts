/**
 * 御驿 Agent MCP server（fork M1 尾巴）。
 *
 * 挂在 daemon 的 `/mcp/yuyi` 路由上，随 per-agent 会话配置注入到每个绑定了
 * 御驿身份的 Paseo agent（注入名 "yuyi"，用户自带同名 server 时让位）。
 *
 * 工具出站一律经 daemon 的单条 Hub 连接收口（YuyiLink），不经每 agent 自连。
 * 机密约束：token 永不出现在任何工具返回里。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { redactSecrets } from "./redact.js";
import { z } from "zod";

/** MCP 工具面对宿主（YuyiService）的最小依赖，避免循环导入 */
export interface YuyiMcpHost {
  /**
   * 出站剥除用的已知凭证原文（P0-2 fail-closed）：设备凭证与各映射 token。
   * 只用于 redactSecrets 的值匹配，绝不出现在任何工具返回里。
   */
  knownSecrets(): string[];
  /** 该 Paseo agent 是否绑定御驿身份（返回绑定的公开视图，不含 token） */
  bindingFor(paseoAgentId: string): { name: string; agentId: string; paseoAgentId: string } | undefined;
  /** 以该 agent 的绑定身份上行发送 */
  sendFromAgent(
    paseoAgentId: string,
    params: { to: string; text: string; mode?: "notify" | "mail"; expectReply?: boolean },
  ): Promise<{ ok: boolean; detail?: string }>;
  /** 连接与绑定快照（公开视图） */
  statusSnapshot(): {
    connected: boolean;
    hub: string;
    device: string;
    principal: "device" | "agent" | null;
    bindings: Array<{ name: string; paseoAgentId: string; title?: string | null }>;
  };
  /** Hub peers 快照 */
  peersSnapshot(): Promise<
    Array<{
      device: string;
      role?: string;
      agentId?: string;
      sessions: Array<{ sessionID: string; name?: string; title?: string }>;
    }>
  >;
}

export interface YuyiMcpServerOptions {
  callerAgentId: string | undefined;
  host: YuyiMcpHost;
}

/**
 * 工具返回唯一出口（P0-2）：所有文本先过 redactSecrets——已知凭证值与凭证形态
 * 一律 [REDACTED]，错误串里意外夹带的机密也出不去（fail-closed）。
 */
function makeTextFn(redact: (s: string) => string) {
  return (t: string, isError = false): CallToolResult =>
    ({ content: [{ type: "text", text: redact(t) }], ...(isError ? { isError: true } : {}) });
}

export async function createYuyiMcpServer(options: YuyiMcpServerOptions): Promise<McpServer> {
  const { callerAgentId, host } = options;
  const text = makeTextFn((s) => redactSecrets(s, host.knownSecrets()));
  const server = new McpServer({ name: "yuyi-mcp", version: "0.1.0" });

  const bound = () =>
    callerAgentId
      ? host.bindingFor(callerAgentId)
      : undefined;

  server.registerTool(
    "yuyi_send",
    {
      title: "御驿发送",
      description:
        "以本 agent 的御驿身份发送消息（经设备端 daemon 的单条 Hub 连接收口）。" +
        'to 支持 "御驿名" / "御驿名:会话ID" / "*"（广播）。expectReply=true 表示期待对方自动回信。',
      inputSchema: {
        to: z.string().min(1).describe('目标御驿名 / "名字:会话ID" / "*" 广播'),
        message: z.string().min(1).describe("消息正文"),
        mode: z.enum(["notify", "mail"]).optional().describe("缺省 notify（在线直投，失败入收件箱）"),
        expectReply: z.boolean().optional().describe("true=期待回信（接收方完成后自动回执）"),
      },
    },
    async (args): Promise<CallToolResult> => {
      const { to, message, mode, expectReply } = args as {
        to: string;
        message: string;
        mode?: "notify" | "mail";
        expectReply?: boolean;
      };
      if (!callerAgentId) {
        return text("yuyi_send 需要调用方 agent 上下文（callerAgentId）", true);
      }
      if (!bound()) {
        return text("本 agent 未绑定御驿身份（未命中 config.yuyi.agents 映射）", true);
      }
      const ack = await host.sendFromAgent(callerAgentId, {
        to,
        text: message,
        ...(mode ? { mode } : {}),
        ...(expectReply ? { expectReply } : {}),
      });
      return ack.ok
        ? text(`已发送给 ${to}${ack.detail ? `（${ack.detail}）` : ""}`)
        : text(`发送失败：${ack.detail ?? "unknown"}`, true);
    },
  );

  server.registerTool(
    "yuyi_status",
    {
      title: "御驿状态",
      description: "本设备的御驿连接状态与身份绑定快照（不含任何机密）。",
      inputSchema: {},
    },
    async (): Promise<CallToolResult> =>
      text(JSON.stringify(host.statusSnapshot(), null, 2)),
  );

  server.registerTool(
    "yuyi_peers",
    {
      title: "御驿同伴",
      description: "Hub 可见的设备与会话清单（寻址 yuyi_send 的 to 时参考）。",
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      try {
        const peers = await host.peersSnapshot();
        return text(JSON.stringify(peers, null, 2));
      } catch (error) {
        return text(`peers 获取失败：${String(error)}`, true);
      }
    },
  );

  return server;
}
