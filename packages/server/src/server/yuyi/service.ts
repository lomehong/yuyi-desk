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
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  sendPromptToAgent,
  waitForAgentRunStartWithTimeout,
} from "../agent/agent-prompt.js";
import { matchMapping, resolveYuyiConfig, type YuyiAgentMapping, type YuyiConfig } from "./config.js";
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
  /** daemon 数据目录（~/.paseo）——凭证缓存落盘位置 */
  agentStoragePath?: string;
  logger: Logger;
}

/** 代领令牌缓存 TTL：72h（御符令牌轮换节奏内；过期即重申领） */
const TOKEN_CACHE_TTL_MS = 72 * 60 * 60 * 1000;

interface TokenCacheEntry {
  token: string;
  claimedAt: number;
}

function readTokenCache(path: string): Record<string, TokenCacheEntry> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, TokenCacheEntry>;
  } catch {
    return {};
  }
}

function writeTokenCache(path: string, cache: Record<string, TokenCacheEntry>): void {
  try {
    writeFileSync(path, JSON.stringify(cache, null, 2), { mode: 0o600 });
  } catch {
    // best-effort；缓存失败只影响下次启动多申领一次
  }
}

/** 读取闸门名单（兼容两代形态：旧 string[] blocked / 新 {blocked, terminated}；
 * 文件缺失/损坏 = 空名单，不因持久化问题拒绝服务） */
type BlockedEntry = { reason: string; at: number; until?: number };

interface GateFile {
  blocked: Record<string, BlockedEntry>;
  terminated: Record<string, { reason: string; at: number }>;
}

/** 读取闸门名单（兼容三代形态：裸 string[] / {blocked: string[]} / {blocked: Record}） */
function readGateFile(path: string): GateFile {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const terminated: GateFile["terminated"] = {};
    let blockedRaw: unknown = parsed;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rec = parsed as GateFile & { blocked?: unknown; terminated?: unknown };
      blockedRaw = rec.blocked ?? parsed;
      if (rec.terminated && typeof rec.terminated === "object") {
        Object.assign(terminated, rec.terminated);
      }
    }
    const blocked: Record<string, BlockedEntry> = {};
    const entries: Array<{ id: string; v?: BlockedEntry }> = Array.isArray(blockedRaw)
      ? (blockedRaw as string[]).map((id) => ({ id }))
      : Object.entries((blockedRaw ?? {}) as Record<string, BlockedEntry>).map(([id, v]) => ({
          id,
          v,
        }));
    for (const e of entries) {
      if (typeof e.id === "string") {
        blocked[e.id] = e.v ?? { reason: "admin", at: 0 };
      }
    }
    return { blocked, terminated };
  } catch {
    return { blocked: {}, terminated: {} };
  }
}

/** gate 事件留痕（yuyi-agent events.jsonl 同款追加审计） */
function appendGateEvent(path: string, event: Record<string, unknown>): void {
  const line = JSON.stringify({ time: Date.now(), ...event });
  try {
    appendFileSync(path, line + "\n", { mode: 0o600 });
  } catch {
    // best-effort
  }
}

// writeFileSync 在顶部 node:fs 导入


export class YuyiService {
  private readonly logger: Logger;
  private link: YuyiLink | null = null;
  private unsubscribeAgents: (() => void) | null = null;
  private byPaseo = new Map<string, YuyiBinding>();
  private injectEnvEnabled = true;
  private cachedConfig: ReturnType<typeof resolveYuyiConfig> | null = null;
  /** 本进程代领到的令牌（agentId → token；映射缺 token 的绑定从这取） */
  private claimedTokens = new Map<string, string>();
  /** 被管理台屏蔽（block）的御符身份——拒绝自动注入/自动回信；until 到期自动解除 */
  private blockedAgents = new Map<string, { reason: string; at: number; until?: number }>();
  /** 被管理台终止（terminate）的身份快照（跨重启保持；同身份重新绑定即清） */
  private terminatedAgents = new Map<string, { reason: string; at: number }>();
  /** device/state 周期上报 timer */
  private stateTimer: ReturnType<typeof setInterval> | null = null;

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

  /**
   * 出站剥除用的凭证原文（P0-2）：设备级连接 token、设备凭证、各映射 token。
   * 只供 redactSecrets 值匹配；mcp-server 的 text() 出口统一剥除。
   */
  knownSecrets(): string[] {
    const config = this.cachedConfig;
    if (!config) return [];
    const secrets: string[] = [];
    if (config.token) secrets.push(config.token);
    for (const agent of config.agents) {
      if (agent.token) secrets.push(agent.token);
    }
    // 绑定态 token（代领结果在 YuyiBinding.token，与 config 可能不同批）
    for (const binding of this.byPaseo.values()) {
      if (binding.token) secrets.push(binding.token);
    }
    return secrets;
  }

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
        agentId: binding.agentId,
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

  /**
   * 各收件身份的未读计数（P0-1 桌面通知轮询用）：只计数不取内容、不标记下发，
   * 高频轮询不产生投递副作用。unread 为 null 表示该来源当前不可用（未连接等），
   * 调用方不得当作 0。
   */
  async unreadSnapshot(): Promise<{
    bindings: Array<{ name: string; recipientID: string; unread: number | null }>;
  }> {
    const bindings = [...this.byPaseo.values()];
    const seen = new Set<string>();
    const targets = bindings.filter((b) => {
      const recipientID = `${b.agentId}:${b.name.toLowerCase()}`;
      if (seen.has(recipientID)) return false;
      seen.add(recipientID);
      return true;
    });
    const results = await Promise.all(
      targets.map(async (b) => {
        const recipientID = `${b.agentId}:${b.name.toLowerCase()}`;
        const unread = this.link ? await this.link.inboxCount(recipientID) : undefined;
        return { name: b.name, recipientID, unread: unread === undefined ? null : unread };
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
    // 凭证代领（R1「设备=Agent 凭证供给通道」）：映射缺 token 时用设备凭证向御符
    // 申领——必须在连接前完成（agent 模式连接身份就是 agents[0] 的 token）
    await this.ensureTokens(config);
    // 恢复闸门状态（yuyi-gate.json：blocked 名单 + terminated 快照，0600）
    const gate = readGateFile(this.gatePath);
    for (const [agentId, entry] of Object.entries(gate.blocked)) {
      this.blockedAgents.set(agentId, entry);
    }
    for (const [agentId, t] of Object.entries(gate.terminated)) {
      this.terminatedAgents.set(agentId, t);
    }
    this.link = new YuyiLink({
      config,
      log: (msg) => this.logger.info(msg),
      deliverToAgent: (binding, message) => this.deliverToAgent(binding, message),
      onDeviceControl: (op, agentId, opts) => this.handleDeviceControl(op, agentId, opts),
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
    // device/state 周期上报（30s；变更即推由 bind/unbind/control 后调 pushDeviceState）
    this.stateTimer = setInterval(() => this.pushDeviceState(), 30_000);
    this.stateTimer.unref?.();
    this.pushDeviceState();
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
    if (this.stateTimer) {
      clearInterval(this.stateTimer);
      this.stateTimer = null;
    }
    this.unsubscribeAgents?.();
    this.unsubscribeAgents = null;
    this.link?.stop();
    this.link = null;
    this.byPaseo.clear();
  }

  /**
   * 上报 device/state（管理台设备视图数据源）。帧结构对齐协议 DeviceStateFrame；
   * 未连接时静默跳过（下个周期重报）。
   */
  pushDeviceState(): void {
    if (!this.link?.connected) {
      return;
    }
    try {
      const config = this.cachedConfig;
      const visibility = config?.activity ?? { busy: false, doing: false, repo: "off" as const };
      const gateAgents = [...this.byPaseo.values()].map((b) => ({
        agentId: b.agentId,
        name: b.name,
        ...(this.isBlocked(b.agentId) ? { blocked: this.blockedAgents.get(b.agentId)! } : {}),
        ...(this.terminatedAgents.has(b.agentId)
          ? { terminated: this.terminatedAgents.get(b.agentId) }
          : {}),
        // P1-7 会话目录：字段级 opt-in——只在配置显式允许时上报对应字段
        ...this.activityFieldsFor(b.paseoAgentId, visibility),
      }));
      this.link.rawRequest({
        type: "device/state",
        id: `devstate_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        daemonVersion: "yuyi-desk",
        gate: { agents: gateAgents },
        claimedAgents: [...this.claimedTokens.keys()],
      });
    } catch (error) {
      this.logger.debug({ err: String(error) }, "device/state report skipped");
    }
  }

  /**
   * P1-7 会话目录字段（按 yuyi.activity 可见性过滤）：
   * busy = lifecycle running 或 hasInFlightRun；doing = Agent 标题；
   * repo = 工作目录名（name-branch 的分支探测 v1 未实现，只回报目录名）。
   * 全部 off 时不产生字段（帧不膨胀）。
   */
  private activityFieldsFor(
    paseoAgentId: string,
    visibility: { busy: boolean; doing: boolean; repo: "off" | "name" | "name-branch" },
  ): Record<string, unknown> {
    if (!visibility.busy && !visibility.doing && visibility.repo === "off") {
      return {};
    }
    const activity: Record<string, unknown> = {};
    try {
      const agent = this.opts.agentManager.getAgent(paseoAgentId);
      if (!agent) return {};
      if (visibility.busy) {
        activity.busy =
          agent.lifecycle === "running" || this.opts.agentManager.hasInFlightRun(paseoAgentId);
      }
      if (visibility.doing && agent.config?.title) {
        activity.doing = String(agent.config.title).slice(0, 80);
      }
      if (visibility.repo !== "off" && agent.cwd) {
        // 目录名即仓库展示名（与 paseo 工作区命名一致）；不含盘符路径
        const parts = String(agent.cwd).replace(/[\\/]+$/, "").split(/[\\/]/);
        const repoName = parts[parts.length - 1];
        if (repoName) activity.repo = repoName;
      }
    } catch {
      // 活动字段是辅助信息——取不到就不带，绝不影响 state 上报本体
    }
    return Object.keys(activity).length > 0 ? { activity } : {};
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

  /**
   * Hub 下发 device/control（管理台闸门，yuyi-agent 吸收合并落地）：
   *   terminate → 运行中先打断，再归档 Paseo agent（UI 可见、可手动恢复）并解绑
   *   block     → 屏蔽该身份的自动注入/自动回信（消息由 Hub 入收件箱，不丢）
   *   release   → 解除屏蔽
   * agentId 为御符权威 id；block 名单持久化 <home>/yuyi-gate.json（0600）。
   */
  /** 屏蔽判定：until 到期自动解除（并持久化） */
  private isBlocked(agentId: string): boolean {
    const entry = this.blockedAgents.get(agentId);
    if (!entry) return false;
    if (entry.until && Date.now() >= entry.until) {
      this.blockedAgents.delete(agentId);
      this.appendGateEvent("release(auto-expired)", agentId);
      this.persistGate();
      return false;
    }
    return true;
  }

  private appendGateEvent(op: string, agentId: string, reason?: string): void {
    appendGateEvent(this.eventsPath, { op, agentId, reason });
  }

  private async handleDeviceControl(
    op: "terminate" | "block" | "release",
    agentId: string,
    _opts?: { reason?: string; until?: number },
  ): Promise<{ ok: boolean; detail?: string }> {
    const binding = [...this.byPaseo.values()].find((b) => b.agentId === agentId);
    if (!binding) {
      return { ok: false, detail: `该身份当前无绑定 agent（${agentId.slice(0, 8)}）` };
    }
    const manager = this.opts.agentManager;
    if (op === "terminate") {
      try {
        await manager.cancelAgentRun(binding.paseoAgentId);
      } catch {
        // 不在运行中——忽略，归档继续
      }
      await manager.archiveAgent(binding.paseoAgentId);
      this.blockedAgents.set(agentId, {
        reason: _opts?.reason ?? "terminated",
        at: Date.now(),
      });
      this.terminatedAgents.set(agentId, {
        reason: _opts?.reason ?? "admin terminate",
        at: Date.now(),
      });
      this.appendGateEvent("terminate", agentId);
      this.persistGate();
      this.pushDeviceState();
      this.link?.unbindPaseo(binding.paseoAgentId);
      this.byPaseo.delete(binding.paseoAgentId);
      return { ok: true, detail: `已停止并归档 agent ${binding.paseoAgentId.slice(0, 8)}（身份已屏蔽自动注入）` };
    }
    if (op === "block") {
      this.blockedAgents.set(agentId, {
        reason: _opts?.reason ?? "admin block",
        at: Date.now(),
        ...(_opts?.until ? { until: _opts.until } : {}),
      });
      this.appendGateEvent("block", agentId, _opts?.reason);
      this.persistGate();
      this.pushDeviceState();
      return { ok: true, detail: `已屏蔽 ${binding.name} 的自动注入（release 解除）` };
    }
    this.blockedAgents.delete(agentId);
    this.appendGateEvent("release", agentId);
    this.persistGate();
    this.pushDeviceState();
      return { ok: true, detail: `已解除 ${binding.name} 屏蔽` };
  }

  private persistGate(): void {
    try {
      writeFileSync(
        this.gatePath,
        JSON.stringify(
          {
            blocked: Object.fromEntries(this.blockedAgents),
            terminated: Object.fromEntries(this.terminatedAgents),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    } catch (error) {
      this.logger.warn({ err: String(error) }, "yuyi gate persist failed");
    }
  }

  private get gatePath(): string {
    return join(this.opts.agentStoragePath ?? join(homedir(), ".yuyi-desk"), "yuyi-gate.json");
  }

  private get eventsPath(): string {
    return join(this.opts.agentStoragePath ?? join(homedir(), ".yuyi-desk"), "yuyi-gate-events.jsonl");
  }

  /**
   * 凭证代领（移植自御驿 packages/agent credentials.ts 的语义，端点
   * POST /api/v1/device/agents/{agentId}/token，设备凭证 Bearer）。
   * 御符申领**非幂等**（每次调用即轮换），沿用其三条护栏：
   *   缓存复用 → 每进程每 agent 至多一次成功申领 → 失败不占配额。
   * 结果落盘 <paseoHome>/yuyi-agent-credentials.json（0600），不回写 config。
   */
  private async ensureTokens(config: ReturnType<typeof resolveYuyiConfig>): Promise<void> {
    const missing = config.agents.filter((m) => !m.token);
    if (missing.length === 0) {
      return;
    }
    const deviceToken =
      config.deviceCredential ??
      (() => {
        try {
          const text = readFileSync(
            join(homedir(), ".yuyi", "yuyi-agent", "device-credential"),
            "utf8",
          ).trim();
          return text.startsWith("dev-") ? text : undefined;
        } catch {
          return undefined;
        }
      })();
    if (!deviceToken) {
      this.logger.warn(
        { agents: missing.map((m) => m.name) },
        "映射缺 token 且无设备凭证（yuyi.deviceCredential 或 ~/.yuyi/yuyi-agent/device-credential），无法代领",
      );
      return;
    }

    const cachePath = join(
      this.opts.agentStoragePath ?? join(homedir(), ".yuyi-desk"),
      "yuyi-agent-credentials.json",
    );
    const cache = readTokenCache(cachePath);
    for (const mapping of missing) {
      const cached = cache[mapping.agentId];
      if (cached?.token && Date.now() - cached.claimedAt < TOKEN_CACHE_TTL_MS) {
        this.claimedTokens.set(mapping.agentId, cached.token);
        continue;
      }
      try {
        const res = await fetch(
          `${config.yufu.replace(/\/$/, "")}/api/v1/device/agents/${encodeURIComponent(mapping.agentId)}/token`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${deviceToken}`,
            },
            signal: AbortSignal.timeout(8000),
          },
        );
        const body = (await res.json().catch(() => ({}))) as {
          agent_token?: string;
          key_id?: string;
          code?: string;
          message?: string;
        };
        if (res.status === 200 && typeof body.agent_token === "string" && body.agent_token) {
          this.claimedTokens.set(mapping.agentId, body.agent_token);
          cache[mapping.agentId] = { token: body.agent_token, claimedAt: Date.now() };
          writeTokenCache(cachePath, cache);
          this.logger.info({ name: mapping.name }, "Yuyi token claimed via device credential");
        } else {
          this.logger.warn(
            { name: mapping.name, http: res.status, detail: body.code ?? body.message },
            "Yuyi token claim rejected",
          );
        }
      } catch (error) {
        this.logger.warn({ name: mapping.name, err: String(error) }, "Yuyi token claim failed");
      }
    }
  }

  /** 映射 token 合并：显式 token 优先，否则用代领结果；两者皆无返回 undefined */
  private mappingWithToken(
    mapping: YuyiAgentMapping,
  ): (YuyiAgentMapping & { token: string }) | undefined {
    if (mapping.token) {
      return mapping as YuyiAgentMapping & { token: string };
    }
    const claimed = this.claimedTokens.get(mapping.agentId);
    return claimed ? { ...mapping, token: claimed } : undefined;
  }

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
    // token 合并：显式配置优先，否则用代领结果；两者皆无则不绑定（fail-closed）
    // 被管理台 terminate 的身份：解绑+屏蔽（跨重启保持）；用户在同一身份下
    // 重新创建 agent 属主动行为——自动清除 terminated 快照允许重新绑定
    if (this.terminatedAgents.has(mapping.agentId)) {
      this.terminatedAgents.delete(mapping.agentId);
      this.persistGate();
    }
    const effectiveMapping = this.mappingWithToken(mapping);
    if (!effectiveMapping) {
      if (this.byPaseo.has(agent.id)) {
        this.link.unbindPaseo(agent.id);
        this.byPaseo.delete(agent.id);
      }
      this.logger.warn(
        { paseoAgentId: agent.id, yuyiName: mapping.name },
        "映射无 token 且代领不可用，跳过绑定",
      );
      return;
    }
    if (this.isBlocked(effectiveMapping.agentId)) {
      this.logger.info(
        { paseoAgentId: agent.id, yuyiName: mapping.name },
        "身份被管理台屏蔽，跳过绑定（release 后恢复）",
      );
      return;
    }
    const binding = this.link.bind(effectiveMapping, agent.id, agent.config?.title);
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
    // 管理台屏蔽（block）的身份：拒绝自动注入——回 wakeup_failed 让 Hub 入
    // 收件箱（消息不丢），release 后可从收件箱补看
    if (this.isBlocked(binding.agentId)) {
      return { ok: false, detail: `身份 ${binding.name} 已被管理台屏蔽自动注入` };
    }
    const prompt = formatYuyiPrompt(message);
    // 快速受理（15s ack 超时实证）：注入超过 5s（agent 冷加载/服务冷启动）即回
    // accepted_async，Hub 不再降级 mail；注入本身继续，失败仅记日志（Hub 侧
    // 已有收件箱重复保险）。5s 内完成则按真实结果回执。
    const injection = sendPromptToAgent({
      agentManager: this.opts.agentManager,
      agentStorage: this.opts.agentStorage,
      agentId: binding.paseoAgentId,
      prompt,
      logger: this.logger,
      unarchive: true, // notify 唤醒语义：归档的 agent 也拉起
      activeTurnBehavior: "steer", // 运行中的 agent → 转向处理新消息
    })
      .then(() => ({ ok: true as const, detail: undefined as string | undefined }))
      .catch((error) => {
        this.logger.warn(
          { err: error, paseoAgentId: binding.paseoAgentId },
          "Yuyi deliver injection failed",
        );
        return { ok: false as const, detail: `injection failed: ${String(error)}` };
      });
    const settled = await Promise.race([
      injection,
      new Promise<{ ok: true; detail: undefined }>((resolve) =>
        setTimeout(() => resolve({ ok: true, detail: undefined }), 5000),
      ),
    ]);
    if (settled.ok) {
      this.logger.info(
        { from: message.from.name ?? message.from.agentId, to: binding.name },
        "Yuyi deliver injected",
      );
      if (message.expectReply) {
        // 快速受理后注入仍在进行（agent 懒加载/冷启动）——autoReply 必须等
        // 注入 settle（agent 实体就位）再启动，否则 waitForAgentRunStart 找不到实体
        void injection.then((r) => {
          if (r.ok) return this.autoReply(binding, message);
          this.logger.warn(
            { detail: r.detail, paseoAgentId: binding.paseoAgentId },
            "注入失败，跳过自动回信",
          );
        });
      }
    }
    return settled;
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
          agentId: binding.agentId,
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
