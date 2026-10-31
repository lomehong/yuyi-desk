/**
 * 御驿（Yuyi）设备端配置节 —— fork 改造（M1）。
 *
 * `~/.paseo/config.json` 根级 `yuyi` 节：Hub 地址、设备名、设备级连接 token
 * （Phase 2 早期语义：缺省透传首个 Agent 的御符 token；后续可换御符设备凭证
 * `dev-{keyid}-{secret}`），以及「Paseo agent ↔ 御驿身份」映射表
 * （御驿名 / 御符 agentId / 御符 token / 匹配规则）。
 *
 * token 是机密：不落日志、不进任何回执与错误信息。
 */
import { hostname } from "node:os";
import { z } from "zod";

/** 注入到 agent 的 MCP server 名（不得为 "paseo"——上游有冲突保护） */
export const YUYI_MCP_SERVER_NAME = "yuyi";

export const YuyiAgentMappingSchema = z.object({
  /** 御驿侧 agent 名（Hub 寻址用；收件人主键为 `agentId:name`） */
  name: z.string().min(1),
  /** 御符签发的 agentId（UUID） */
  agentId: z.string().min(1),
  /** 御符签发的 agent token（机密） */
  token: z.string().min(1),
  /**
   * 匹配规则：命中本身份的 Paseo agent（首个命中胜出；同身份多个命中时最新绑定胜出）。
   * 缺省不自动绑定——该身份仅可被显式指定使用。
   */
  match: z
    .object({
      /** provider glob：`"claude/*"`、`"opencode/some-model"`、`"*"` */
      provider: z.string().optional(),
      /** title 精确匹配 */
      title: z.string().optional(),
    })
    .optional(),
});

export const YuyiConfigSchema = z.object({
  /** 总开关；false = daemon 不连 Hub、不注入任何御驿能力 */
  enabled: z.boolean().optional(),
  /** 御驿 Hub WS 地址（ws:// 或 wss://） */
  hub: z.string().min(1),
  /**
   * 设备名。缺省 `${hostname}-desk`——沿用御驿 device 契约（接入面后缀），
   * 与本机其他御驿接入面（opencode/mcp/omp…）天然不同 device，避免撞号互踢。
   */
  device: z.string().optional(),
  /** 设备级连接 token；缺省透传 agents[0].token（yuyi-agent Phase 2 早期同款语义） */
  token: z.string().optional(),
  /** hello.agentKind（Hub 侧指标分组）；缺省 "yuyi-desk" */
  agentKind: z.string().optional(),
  /** 是否向被管理的 agent 注入 YUYI_* 环境变量；缺省 true */
  injectEnv: z.boolean().optional(),
  agents: z.array(YuyiAgentMappingSchema),
});

export type YuyiAgentMapping = z.infer<typeof YuyiAgentMappingSchema>;
export type YuyiConfig = z.infer<typeof YuyiConfigSchema>;

/** 解析后的运行时配置（填默认值；token 保持原样传递） */
export interface ResolvedYuyiConfig {
  hub: string;
  device: string;
  token: string | undefined;
  agentKind: string;
  injectEnv: boolean;
  agents: YuyiAgentMapping[];
}

export function resolveYuyiConfig(config: YuyiConfig): ResolvedYuyiConfig {
  return {
    hub: config.hub,
    device: config.device?.trim() || `${hostname()}-desk`,
    token: config.token?.trim() || config.agents[0]?.token,
    agentKind: config.agentKind?.trim() || "yuyi-desk",
    injectEnv: config.injectEnv !== false,
    agents: config.agents,
  };
}

/** provider glob 匹配（`"*"` / `"claude/*"` 前缀 / 精确） */
export function providerMatches(pattern: string, provider: string): boolean {
  if (pattern === "*" || pattern === provider) {
    return true;
  }
  if (pattern.endsWith("/*")) {
    return provider.startsWith(pattern.slice(0, -1));
  }
  return false;
}

/** 判断某个 Paseo agent 快照命中哪条映射（首个命中胜出） */
export function matchMapping(
  agents: YuyiAgentMapping[],
  agent: { provider: string; title?: string | null },
): YuyiAgentMapping | undefined {
  return agents.find((mapping) => {
    const rules = mapping.match;
    if (!rules) {
      return false;
    }
    if (rules.provider && !providerMatches(rules.provider, agent.provider)) {
      return false;
    }
    if (rules.title && rules.title !== (agent.title ?? "")) {
      return false;
    }
    return true;
  });
}
