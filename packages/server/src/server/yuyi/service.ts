/**
 * YuyiService —— 御驿设备端编排（fork M1）。
 *
 * 职责：
 *   - 持有 YuyiLink（设备主体 Hub 连接），把 config.yuyi.agents 映射表绑定到
 *     匹配的 Paseo agent（初始 listAgents + subscribe 事件流增量维护）。
 *   - deliver → prompt 注入：sendPromptToAgent（unarchive=true 唤醒语义，
 *     运行中 steer）；expectReply 时等 turn 完成后自动回信（先等 run start
 *     再等 finish，避开「注入后立刻查询、run 尚未启动读到旧状态」的竞态）。
 *   - per-agent YUYI_* 环境变量注入（经 AgentManager.setYuyiEnvResolver）。
 *
 * M1 边界：不做设备闸门（device/control 回绝）、不做 device/state 上报、
 * 不做凭证代领（映射表为显式配置）。
 */
import type { Logger } from "pino";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import {
  sendPromptToAgent,
  waitForAgentRunStartWithTimeout,
} from "../agent/agent-prompt.js";
import { matchMapping, resolveYuyiConfig, type YuyiConfig } from "./config.js";
import { YuyiLink, type YuyiBinding } from "./link.js";
import type { YuyiMessage } from "@qianji/protocol";

type AgentEvent = Parameters<Parameters<AgentManager["subscribe"]>[0]>[0];

/** 事件/清单里的 agent 快照（只取我们关心的字段） */
interface AgentSnapshotLike {
  id: string;
  provider: string;
  internal?: boolean;
  config?: { title?: string | null } | null;
}

export interface YuyiServiceOptions {
  yuyiConfig: YuyiConfig | undefined;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
}

export class YuyiService {
  private readonly logger: Logger;
  private link: YuyiLink | null = null;
  private unsubscribeAgents: (() => void) | null = null;
  private byPaseo = new Map<string, YuyiBinding>();
  private injectEnvEnabled = true;
  private cachedConfig: ReturnType<typeof resolveYuyiConfig> | null = null;

  constructor(private readonly opts: YuyiServiceOptions) {
    this.logger = opts.logger.child({ module: "yuyi" });
  }

  get connected(): boolean {
    return this.link?.connected ?? false;
  }

  /** MCP 注入是否激活（yuyi 配置就绪且 link 已建） */
  get mcpActive(): boolean {
    return this.link !== null;
  }

  // ---- YuyiMcpHost 实现（/mcp/yuyi 工具面；返回值不含机密） ----

  bindingFor(paseoAgentId: string): { name: string; agentId: string; paseoAgentId: string } | undefined {
    const binding = this.byPaseo.get(paseoAgentId);
    return binding
      ? { name: binding.name, agentId: binding.agentId, paseoAgentId: binding.paseoAgentId }
      : undefined;
  }

  async sendFromAgent(
    paseoAgentId: string,
    params: { to: string; text: string; mode?: "notify" | "mail"; expectReply?: boolean },
  ): Promise<{ ok: boolean; detail?: string }> {
    const binding = this.byPaseo.get(paseoAgentId);
    const config = this.cachedConfig;
    if (!binding || !config || !this.link) {
      return { ok: false, detail: "本 agent 未绑定御驿身份或链接未激活" };
    }
    // 协议契约：expectReply 经 Envelope.task 携带，必须有 taskId 才不丢（E2E 实证）
    const expectReply = params.expectReply === true;
    const message: YuyiMessage = {
      id: `yuyidesk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      mode: params.mode ?? "notify",
      text: params.text,
      from: {
        device: config.device,
        sessionID: `${binding.name}:${binding.paseoAgentId}`,
        name: binding.name,
      },
      to: { target: params.to },
      time: Date.now(),
      ...(expectReply
        ? { expectReply: true, taskId: `task_yuyidesk_${Date.now().toString(36)}` }
        : {}),
    };
    return this.link.sendFromBinding(binding, message);
  }

  statusSnapshot(): {
    connected: boolean;
    hub: string;
    device: string;
    principal: "device" | "agent" | null;
    bindings: Array<{ name: string; paseoAgentId: string; title?: string | null }>;
  } {
    return {
      connected: this.connected,
      hub: this.cachedConfig?.hub ?? "",
      device: this.cachedConfig?.device ?? "",
      principal: this.link?.principal ?? null,
      bindings: [...this.byPaseo.values()].map((b) => ({
        name: b.name,
        paseoAgentId: b.paseoAgentId,
        title: b.sessions[0]?.title ?? null,
      })),
    };
  }

  async peersSnapshot(): Promise<
    Array<{
      device: string;
      role?: string;
      agentId?: string;
      sessions: Array<{ sessionID: string; name?: string; title?: string }>;
    }>
  > {
    const raw = (await this.link?.peers()) as Array<Record<string, unknown>> | undefined;
    if (!raw) {
      throw new Error("yuyi hub offline");
    }
    return raw.map((d) => ({
      device: String(d.device ?? ""),
      role: d.role === undefined ? undefined : String(d.role),
      agentId: d.agentId === undefined ? undefined : String(d.agentId),
      sessions: Array.isArray(d.sessions)
        ? (d.sessions as Array<Record<string, unknown>>).map((s) => ({
            sessionID: String(s.sessionID ?? ""),
            name: s.name === undefined ? undefined : String(s.name),
            title: s.title === undefined ? undefined : String(s.title),
          }))
        : [],
    }));
  }

  /** 逐绑定拉取 Hub 收件箱（全部条目）；单绑定失败不拖垮整体，记 error 字段 */
  async inboxSnapshot(): Promise<{
    bindings: Array<{
      name: string;
      recipientID: string;
      entries: unknown[];
      error?: string;
    }>;
  }> {
    const bindings = [...this.byPaseo.values()];
    // 收件箱是身份级（recipientID 唯一）：同身份多绑定（如多个匹配的 Paseo agent）
    // 只取一次，避免 UI 重复渲染
    const seenRecipients = new Set<string>();
    const targets = bindings.filter((b) => {
      const recipientID = `${b.agentId}:${b.name.toLowerCase()}`;
      if (seenRecipients.has(recipientID)) return false;
      seenRecipients.add(recipientID);
      return true;
    });
    const results = await Promise.all(
      targets.map(async (b) => {
        const recipientID = `${b.agentId}:${b.name.toLowerCase()}`;
        try {
          const entries = (await this.link?.inboxFetch(recipientID)) as unknown[] | undefined;
          return {
            name: b.name,
            recipientID,
            entries: entries ?? [],
          };
        } catch (error) {
          return {
            name: b.name,
            recipientID,
            entries: [] as unknown[],
            error: String(error),
          };
        }
      }),
    );
    return { bindings: results };
  }

  /** 标记某绑定的收件箱条目已读（Hub 侧清读即删） */
  async inboxAckFor(name: string, ids: string[]): Promise<{ ok: boolean; detail?: string }> {
    const binding = [...this.byPaseo.values()].find((b) => b.name === name);
    if (!binding || !this.link) {
      return { ok: false, detail: `未找到绑定 ${name}` };
    }
    try {
      const ack = await this.link.inboxAck(ids, `${binding.agentId}:${binding.name.toLowerCase()}`);
      return { ok: ack.ok, detail: ack.detail };
    } catch (error) {
      return { ok: false, detail: String(error) };
    }
  }

  async start(): Promise<void> {
    const raw = this.opts.yuyiConfig;
    if (!raw || raw.enabled === false || !raw.hub || raw.agents.length === 0) {
      this.logger.info("Yuyi link not configured; skipping");
      return;
    }
    const config = resolveYuyiConfig(raw);
    this.cachedConfig = config;
    this.injectEnvEnabled = config.injectEnv;
    this.link = new YuyiLink({
      config,
      log: (msg) => this.logger.info(msg),
      deliverToAgent: (binding, message) => this.deliverToAgent(binding, message),
    });
    // 初始绑定：持久层扫描（注册表懒加载，listAgents 只含已初始化 agent）+ 内存扫描
    this.rescanBindings();
    this.unsubscribeAgents = this.opts.agentManager.subscribe((event: AgentEvent) => {
      if (event.type === "agent_state") {
        this.rebindAgent(event.agent as AgentSnapshotLike);
      } else if (event.type === "agent_removed") {
        this.onAgentRemoved(event.agentId);
      }
    });
    // 注册表恢复可能在 service.start() 之后完成且不逐个发事件——延迟重扫兜底
    for (const delay of [5_000, 20_000]) {
      const t = setTimeout(() => this.rescanBindings(), delay);
      t.unref?.();
    }
    this.link.start();
    this.logger.info(
      {
        hub: config.hub,
        device: config.device,
        agents: config.agents.map((a) => a.name),
      },
      "Yuyi link started",
    );
  }

  async stop(): Promise<void> {
    this.unsubscribeAgents?.();
    this.unsubscribeAgents = null;
    this.link?.stop();
    this.link = null;
    this.byPaseo.clear();
  }

  /** AgentManager.buildLaunchContext 注入 YUYI_* env（未启用/未绑定返回 null） */
  envForAgent(paseoAgentId: string): Record<string, string> | null {
    if (!this.link || !this.injectEnvEnabled) {
      return null;
    }
    const binding = this.byPaseo.get(paseoAgentId);
    const config = this.cachedConfig;
    if (!binding || !config) {
      return null;
    }
    return {
      YUYI_HUB: config.hub,
      YUYI_DEVICE: config.device,
      YUYI_NAME: binding.name,
      YUYI_AGENT_ID: binding.agentId,
      YUYI_TOKEN: binding.token,
    };
  }

  // ---- 内部 ----

  /** 持久层 + 内存全量重扫绑定 */
  private async rescanBindings(): Promise<void> {
    try {
      const records = await this.opts.agentStorage.list();
      for (const record of records) {
        if (record.internal || record.archivedAt) {
          continue;
        }
        this.rebindAgent({
          id: record.id,
          provider: record.provider,
          config: { title: record.title ?? null },
        });
      }
    } catch (error) {
      this.logger.warn({ err: error }, "Yuyi storage rescan failed");
    }
    for (const agent of this.opts.agentManager.listAgents()) {
      this.rebindAgent(agent as AgentSnapshotLike);
    }
  }

  /** agent 出现/变化 → 重新匹配映射表（不命中则解绑） */
  private rebindAgent(agent: AgentSnapshotLike): void {
    if (!this.link || agent.internal) {
      return;
    }
    const config = this.cachedConfig;
    if (!config) {
      return;
    }
    const mapping = matchMapping(config.agents, {
      provider: agent.provider,
      title: agent.config?.title,
    });
    if (!mapping) {
      // 之前绑定过、现在不再匹配 → 解绑
      if (this.byPaseo.has(agent.id)) {
        this.link.unbindPaseo(agent.id);
        this.byPaseo.delete(agent.id);
      }
      return;
    }
    const prev = this.byPaseo.get(agent.id);
    const binding = this.link.bind(mapping, agent.id, agent.config?.title);
    this.byPaseo.set(agent.id, binding);
    if (!prev || prev.name !== mapping.name) {
      this.logger.info(
        { paseoAgentId: agent.id, provider: agent.provider, yuyiName: mapping.name },
        "Yuyi agent bound",
      );
    }
  }

  private onAgentRemoved(agentId: string): void {
    if (!this.link) {
      return;
    }
    if (this.byPaseo.has(agentId)) {
      this.link.unbindPaseo(agentId);
      this.byPaseo.delete(agentId);
    }
  }

  /** deliver 到达：注入 prompt；expectReply 时异步等待完成并自动回信 */
  private async deliverToAgent(
    binding: YuyiBinding,
    message: YuyiMessage,
  ): Promise<{ ok: boolean; detail?: string }> {
    const prompt = formatYuyiPrompt(message);
    try {
      await sendPromptToAgent({
        agentManager: this.opts.agentManager,
        agentStorage: this.opts.agentStorage,
        agentId: binding.paseoAgentId,
        prompt,
        logger: this.logger,
        unarchive: true, // notify 唤醒语义：归档的 agent 也拉起
        activeTurnBehavior: "steer", // 运行中的 agent → 转向处理新消息
      });
    } catch (error) {
      this.logger.warn(
        { err: error, paseoAgentId: binding.paseoAgentId },
        "Yuyi deliver injection failed",
      );
      return { ok: false, detail: `injection failed: ${String(error)}` };
    }
    this.logger.info(
      { from: message.from.name ?? message.from.agentId, to: binding.name },
      "Yuyi deliver injected",
    );
    if (message.expectReply) {
      void this.autoReply(binding, message);
    }
    return { ok: true };
  }

  /** 等 run start → 等 finish → 以绑定身份回信（notify 模式，replyTo 关联原消息） */
  private async autoReply(binding: YuyiBinding, message: YuyiMessage): Promise<void> {
    const manager = this.opts.agentManager;
    try {
      this.logger.info({ replyTo: message.id }, "Yuyi auto-reply wait start");
      await waitForAgentRunStartWithTimeout(manager, binding.paseoAgentId);
      const wait = await manager.waitForAgentEvent(binding.paseoAgentId, {
        waitForActive: true,
      });
      this.logger.info(
        { status: wait.status, permission: Boolean(wait.permission) },
        "Yuyi auto-reply wait done",
      );
      const text = wait.permission
        ? "（执行已暂停：等待权限确认，暂无最终结果）"
        : (wait.lastMessage?.trim() || "（执行完成，无文本输出）");
      if (!this.link || !this.cachedConfig) {
        return;
      }
      const reply: YuyiMessage = {
        id: `yuyidesk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        mode: "notify",
        text,
        from: {
          device: this.cachedConfig.device,
          sessionID: `${binding.name}:${binding.paseoAgentId}`,
          name: binding.name,
        },
        to: { target: replyTarget(message) },
        time: Date.now(),
        replyTo: message.id,
        ...(message.taskId ? { taskId: message.taskId } : {}),
        ...(message.traceId ? { traceId: message.traceId } : {}),
        ...(typeof message.hopCount === "number" ? { hopCount: message.hopCount } : {}),
      };
      const ack = await this.link.sendFromBinding(binding, reply);
      this.logger.info(
        { ok: ack.ok, detail: ack.detail },
        ack.ok ? "Yuyi auto-reply sent" : "Yuyi auto-reply send failed",
      );
    } catch (error) {
      this.logger.warn(
        { err: error, paseoAgentId: binding.paseoAgentId },
        "Yuyi auto-reply failed",
      );
    }
  }
}

/** 组装注入 prompt（来源可辨识；expectReply 时告知将有自动回信） */
function formatYuyiPrompt(message: YuyiMessage): string {
  const sender =
    message.from.name ?? message.from.ownerUsername ?? message.from.agentId ?? "unknown";
  const lines = [`【御驿消息】来自 ${sender}（device: ${message.from.device}）`, "", message.text];
  if (message.expectReply) {
    lines.push("", "（本消息期待回信：本轮完成后你的最终回复将自动回传给发送方）");
  }
  return lines.join("\n");
}

/** 回信目标：优先发送方名，其次其会话 ID */
function replyTarget(message: YuyiMessage): string {
  return message.from.name ?? message.from.sessionID ?? "*";
}
