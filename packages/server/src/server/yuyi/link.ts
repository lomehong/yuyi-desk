/**
 * YuyiLink —— 御驿设备主体 Hub 连接（fork M1）。
 *
 * 移植自御驿主仓库 packages/agent/src/hub-link.ts（Phase 2/3 连接收口），按 fork
 * 形态改造：本地「绑定」不再是本地 socket，而是 daemon 管理的 Paseo agent。
 *
 *   - 一台设备 = 一个 daemon = 一条 Hub WS（principal="device"）。
 *   - 承载的 Agent 身份一律经 agent/register 逐个验证建立（D9：设备不替 Agent 背书，
 *     Hub 对每个 Agent 独立跑御符 verify）。注册结果是**连接内**状态，重连后重建。
 *   - 上行会话 ID 合成 `${御驿名}:${paseoAgentId}`（与 send 的 from.sessionID 同形态）。
 *   - 下行 deliver：解析 to.target → 绑定 → service 注入；注入成功即回
 *     accepted_async（自动回信后续完成），失败回 wakeup_failed（Hub 降级 mail，消息不丢）。
 */
import { HubClient } from "@qianji/core/hub-client";
import type { DeliverResult, RosterSession, YuyiMessage } from "@qianji/protocol";
import type { ResolvedYuyiConfig, YuyiAgentMapping } from "./config.js";

/** 一个已绑定的本地 Agent：御驿身份 ↔ Paseo agent */
export interface YuyiBinding {
  /** 御符 agentId（权威，registerAgent / send 行动者声明用） */
  agentId: string;
  /** 御驿名（Hub 寻址） */
  name: string;
  /** 御符 agent token（机密：只在内存，不落日志） */
  token: string;
  /** 绑定的 Paseo agent id（注入目标） */
  paseoAgentId: string;
  /** roster 会话（sessionID = paseoAgentId；上行合成 `${name}:${paseoAgentId}`） */
  sessions: RosterSession[];
}

export interface YuyiLinkOptions {
  config: ResolvedYuyiConfig;
  log: (msg: string) => void;
  /** deliver 命中绑定后由 service 注入 Paseo agent；返回是否已受理 */
  deliverToAgent: (
    binding: YuyiBinding,
    message: YuyiMessage,
  ) => Promise<{ ok: boolean; detail?: string }>;
}

export class YuyiLink {
  private hub: HubClient | null = null;
  private byName = new Map<string, YuyiBinding>();
  private byPaseo = new Map<string, YuyiBinding>();
  /** 已在当前连接上注册成功的 agentId（连接断开即失效，重连后重建） */
  private registered = new Map<string, boolean>();
  private readonly opts: YuyiLinkOptions;

  constructor(opts: YuyiLinkOptions) {
    this.opts = opts;
  }

  get connected(): boolean {
    return this.hub?.connected ?? false;
  }

  /** Hub 认定的连接主体（welcome 回带；未握手时 undefined） */
  get principal(): "device" | "agent" | undefined {
    return this.hub?.connectionPrincipal;
  }

  /** 启动设备级 Hub WS */
  start(): void {
    if (this.hub) {
      return;
    }
    const { config } = this.opts;
    if (!config.token) {
      this.opts.log("[yuyi] 缺少设备级 token（yuyi.token / agents[0].token 均未配置），不连接 Hub");
      return;
    }
    this.hub = new HubClient({
      url: config.hub,
      device: config.device,
      instanceID: `yuyi-desk_${config.device}_${Math.random().toString(36).slice(2, 8)}`,
      token: config.token,
      agentKind: config.agentKind,
      adapterVersion: "yuyi-desk-m1",
      // 缺省设备主体（Agent 身份经 agent/register 逐个验证）；"agent" 为兼容模式：
      // 单身份连接，roster 经 updateRoster 上行（Hub 部署不支持设备路径时过渡）。
      principal: config.principal,
      capabilities: { wake: true },
      log: this.opts.log,
      // 建连/重连后重新注册全部本地 Agent（注册不跨连接存活）
      onWelcome: () => {
        void this.registerAll();
      },
      // M1 未实现设备闸门：device/control 到达即回「未实现」，Hub 侧 10s 应答超时语义正常
      onServerFrame: (frame) => {
        if (frame.type !== "device/control") {
          return;
        }
        const control = frame as import("@qianji/protocol").DeviceControlFrame;
        this.opts.log(`[yuyi] device/control(${control.op}) 到达：M1 未实现闸门，回绝`);
        this.hub?.rawAck(control.id, false, "yuyi-desk M1: device control not implemented");
      },
      onDeliver: async (message: YuyiMessage): Promise<DeliverResult> => {
        const targetName = this.resolveTargetName(message.to.target);
        if (targetName) {
          const binding = this.byName.get(targetName);
          if (binding) {
            const handlerSessionID = `${binding.name}:${binding.paseoAgentId}`;
            const r = await this.opts.deliverToAgent(binding, message);
            return r.ok
              ? { status: "accepted_async", handlerSessionID }
              : { status: "wakeup_failed", detail: r.detail };
          }
        }
        return {
          status: "wakeup_failed",
          detail: `no bound agent for target "${message.to.target}"`,
        };
      },
      onUnreadMail: undefined,
    });
    this.hub.start();
  }

  stop(): void {
    this.hub?.stop();
    this.hub = null;
    this.registered.clear();
  }

  /**
   * 建立/替换绑定（同御驿名出现新的匹配 Paseo agent 时换绑——最新胜出），
   * 并立即（重）注册到 Hub。Hub 未连时由 onWelcome 补做。
   */
  bind(mapping: YuyiAgentMapping & { token: string }, paseoAgentId: string, title?: string | null): YuyiBinding {
    const previous = this.byName.get(mapping.name);
    if (previous) {
      if (previous.paseoAgentId !== paseoAgentId) {
        this.byPaseo.delete(previous.paseoAgentId);
      }
    }
    const sessions: RosterSession[] = [
      { sessionID: paseoAgentId, name: mapping.name, ...(title ? { title } : {}) },
    ];
    const binding: YuyiBinding = {
      agentId: mapping.agentId,
      name: mapping.name,
      token: mapping.token,
      paseoAgentId,
      sessions,
    };
    this.byName.set(mapping.name, binding);
    this.byPaseo.set(paseoAgentId, binding);
    if (this.hub?.connectionPrincipal === "device") {
      void this.registerAgent(binding);
    } else if (this.hub?.connected) {
      // agent 兼容模式：roster 上行（会话 ID 合成 `${name}:${paseoAgentId}`，
      // 与 send 的 from.sessionID 同形态）
      this.hub.updateRoster(
        sessions.map((s) => ({ ...s, sessionID: `${binding.name}:${s.sessionID}` })),
      );
    }
    return binding;
  }

  unbindPaseo(paseoAgentId: string): void {
    const binding = this.byPaseo.get(paseoAgentId);
    if (!binding) {
      return;
    }
    this.byPaseo.delete(paseoAgentId);
    if (this.byName.get(binding.name) === binding) {
      this.byName.delete(binding.name);
    }
    this.registered.delete(binding.agentId);
  }

  bindingByPaseo(paseoAgentId: string): YuyiBinding | undefined {
    return this.byPaseo.get(paseoAgentId);
  }

  /**
   * 以某绑定的身份上行发送（自动回信 / 工具 send 用）。
   * 设备连接必须声明行动 Agent——agentId 取绑定内御符权威值而非自报。
   */
  async sendFromBinding(
    binding: YuyiBinding,
    message: YuyiMessage,
  ): Promise<{ ok: boolean; detail?: string }> {
    const hub = this.hub;
    if (!hub?.connected) {
      return { ok: false, detail: "yuyi hub offline" };
    }
    // 设备连接必须声明行动 Agent；agent 兼容模式连接自带身份，忽略该字段
    const from =
      hub.connectionPrincipal === "device"
        ? {
            agentId: binding.agentId,
            name: binding.name,
            sessionID: `${binding.name}:${binding.paseoAgentId}`,
          }
        : undefined;
    return hub.send(message, from);
  }

  /** Hub peers 快照（未连接时抛错由调用方兜底） */
  async peers(): Promise<unknown> {
    if (!this.hub?.connected) {
      throw new Error("yuyi hub offline");
    }
    return this.hub.peers();
  }

  /** 拉取 Hub 侧收件箱（recipient 缺省=连接自身身份；drain 至末尾） */
  async inboxFetch(recipient?: string) {
    if (!this.hub?.connected) {
      throw new Error("yuyi hub offline");
    }
    return this.hub.inboxDrain(recipient, 20);
  }

  /** 标记收件箱条目已读（Hub 侧清读即删） */
  async inboxAck(ids: string[], recipient?: string) {
    if (!this.hub?.connected) {
      throw new Error("yuyi hub offline");
    }
    return this.hub.inboxAck(ids, recipient);
  }

  /** 向 Hub 注册一个本地 Agent（Hub 侧独立跑御符 verify，D9） */
  private async registerAgent(binding: YuyiBinding): Promise<void> {
    const hub = this.hub;
    if (!hub || hub.connectionPrincipal !== "device") {
      return;
    }
    const sessions = binding.sessions.map((session) => ({
      ...session,
      sessionID: `${binding.name}:${session.sessionID}`,
    }));
    try {
      const r = await hub.registerAgent(binding.token, sessions);
      if (r.ok) {
        const changed = !this.registered.get(binding.agentId);
        this.registered.set(binding.agentId, true);
        if (changed) {
          this.opts.log(`[yuyi] Agent ${binding.name} 注册成功（${sessions.length} 会话）`);
        }
      } else {
        this.registered.delete(binding.agentId);
        this.opts.log(`[yuyi] 注册 Agent ${binding.name} 被拒：${r.detail ?? "unknown"}`);
      }
    } catch (error) {
      this.registered.delete(binding.agentId);
      this.opts.log(`[yuyi] 注册 Agent ${binding.name} 异常：${String(error)}`);
    }
  }

  /** 重连后重建全部 Agent 身份 */
  private async registerAll(): Promise<void> {
    for (const binding of this.byName.values()) {
      await this.registerAgent(binding);
    }
  }

  /**
   * to.target 解析出御驿名。支持 "name" / "name:sessionID" / "agentId:name"
   * / "agentId:name:sessionID" 等形态：按段探测 byName，第一个命中的段即名字
   * （agentId/device 前缀不会命中 byName；名字本身不含 ':'）。
   */
  private resolveTargetName(target: string): string | undefined {
    if (!target || target === "*") {
      return undefined;
    }
    if (this.byName.has(target)) {
      return target;
    }
    const parts = target.split(":");
    for (let i = 0; i < parts.length - 1; i++) {
      if (this.byName.has(parts[i])) {
        return parts[i];
      }
    }
    return undefined;
  }
}
