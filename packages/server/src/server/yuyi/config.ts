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
import { readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { z } from "zod";

/** 注入到 agent 的 MCP server 名（不得为 "paseo"——上游有冲突保护） */
export const YUYI_MCP_SERVER_NAME = "yuyi";

export const YuyiAgentMappingSchema = z.object({
  /** 御驿侧 agent 名（Hub 寻址用；收件人主键为 `agentId:name`） */
  name: z.string().min(1),
  /** 御符签发的 agentId（UUID） */
  agentId: z.string().min(1),
  /**
   * 御符签发的 agent token（机密）。**可省略**：配置了设备凭证时，
   * 服务启动会自动用设备凭证向御符代领（结果落盘缓存复用，
   * 不回写 config——申领接口非幂等，每次调用即轮换）。
   */
  token: z.string().min(1).optional(),
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
  /** 御符地址（凭证代领用）；缺省读 ~/.yuyi/agent.json 的 yufu_url，再缺省官方地址 */
  yufu: z.string().optional(),
  /**
   * 设备名。缺省 `${hostname}-desk`——沿用御驿 device 契约（接入面后缀），
   * 与本机其他御驿接入面（opencode/mcp/omp…）天然不同 device，避免撞号互踢。
   */
  device: z.string().optional(),
  /** 设备级连接 token；缺省透传 agents[0].token（yuyi-agent Phase 2 早期同款语义） */
  token: z.string().optional(),
  /** hello.agentKind（Hub 侧指标分组）；缺省 "yuyi-desk" */
  agentKind: z.string().optional(),
  /**
   * 设备凭证（dev-*，御符签发）。配置后可为 agents 里缺 token 的映射自动
   * 代领令牌（R1「设备=Agent 凭证供给通道」）；缺省读
   * `~/.yuyi/yuyi-agent/device-credential`（yuyi-agent 标准位置）。
   */
  deviceCredential: z.string().optional(),
  /**
   * 连接主体：缺省 "device"（目标形态，设备凭证 + agent/register）。
   * "agent" = 兼容模式：单身份连接（token 用 agents[0].token），roster 走
   * updateRoster 上行——用于 Hub 部署尚不支持设备主体路径时的过渡。
   */
  principal: z.enum(["device", "agent"]).optional(),
  /** 是否向被管理的 agent 注入 YUYI_* 环境变量；缺省 true */
  injectEnv: z.boolean().optional(),
  /**
   * P1-7 会话目录可见性（借鉴 Reason 团队目录；字段级最小可见，逐字段 opt-in）：
   *   busy  缺省 true——忙闲（lifecycle running 视为忙）
   *   doing 缺省 false——Agent 标题摘要（可能含任务语义，显式开启才上报）
   *   repo  缺省 "off"——"name" 仅仓库名（cwd 目录名）；"name-branch" 含分支
   *         （分支需 git 探测，v1 未实现，配置了也只回报 repo 名）
   */
  activity: z
    .object({
      busy: z.boolean().optional(),
      doing: z.boolean().optional(),
      repo: z.enum(["off", "name", "name-branch"]).optional(),
    })
    .optional(),
  agents: z.array(YuyiAgentMappingSchema),
});

export type YuyiAgentMapping = z.infer<typeof YuyiAgentMappingSchema>;
export type YuyiConfig = z.infer<typeof YuyiConfigSchema>;

/** 解析后的运行时配置（填默认值；token 保持原样传递） */
export interface ResolvedYuyiConfig {
  hub: string;
  yufu: string;
  deviceCredential: string | undefined;
  device: string;
  token: string | undefined;
  agentKind: string;
  injectEnv: boolean;
  principal: "device" | "agent";
  /** P1-7 字段级可见性（解析后带缺省） */
  activity: {
    busy: boolean;
    doing: boolean;
    repo: "off" | "name" | "name-branch";
  };
  agents: YuyiAgentMapping[];
}

const DEFAULT_YUFU_URL = "https://yufu.qianji.io";

/** ~/.yuyi/agent.json 的 yufu_url（御符地址的生态默认来源） */
function readYufuUrlFromAgentJson(): string | undefined {
  try {
    const agentJson = JSON.parse(
      readFileSync(join(homedir(), ".yuyi", "agent.json"), "utf8"),
    ) as { yufu_url?: string };
    return typeof agentJson.yufu_url === "string" ? agentJson.yufu_url : undefined;
  } catch {
    return undefined;
  }
}

/** yuyi-agent 标准位置的设备凭证文件 */
export function readDeviceCredentialFile(): string | undefined {
  try {
    const text = readFileSync(
      join(homedir(), ".yuyi", "yuyi-agent", "device-credential"),
      "utf8",
    ).trim();
    return text.startsWith("dev-") ? text : undefined;
  } catch {
    return undefined;
  }
}

export function resolveYuyiConfig(config: YuyiConfig): ResolvedYuyiConfig {
  const principal = config.principal ?? "device";
  return {
    hub: config.hub,
    yufu: config.yufu?.trim() || readYufuUrlFromAgentJson() || DEFAULT_YUFU_URL,
    deviceCredential: config.deviceCredential?.trim() || readDeviceCredentialFile(),
    device: config.device?.trim() || `${hostname()}-desk`,
    // 连接 token 按主体分派（M1 实证：device hello 对 agent token 会被御符拒绝）：
    //   device 主体 → 设备凭证（显式 config.token 优先，缺省即 deviceCredential）
    //   agent  主体 → 身份 token（agents[0]）
    token:
      principal === "device"
        ? config.token?.trim() ||
          config.deviceCredential?.trim() ||
          readDeviceCredentialFile()
        : config.token?.trim() || config.agents[0]?.token,
    agentKind: config.agentKind?.trim() || "yuyi-desk",
    injectEnv: config.injectEnv !== false,
    activity: {
      busy: config.activity?.busy !== false,
      doing: config.activity?.doing === true,
      repo: config.activity?.repo ?? "off",
    },
    principal,
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
