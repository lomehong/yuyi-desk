/**
 * 御驿 Agent 微信 · 本地会话存储（M1，设计 §6-2）。
 *
 * Owner 直发/收信的会话流水落 daemon 数据目录 `conversations/`：
 *   - conversations.json：索引（peerKey → { peer, lastAt, lastText, unread }）
 *   - <peerKey 安全化>.jsonl：逐条消息 append（不删，收件箱 ack 后本地留档）
 *
 * 未读语义（设计 §3）：主区会话未读 = 本地落盘计数（notify 直投不进 inbox，
 * /api/yuyi/unread 推导不出）；打开会话页即清零。
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** 会话对端（联系人条目快照，展示用） */
export interface PeerRef {
  /** canonical peerKey（agentId:name 或 owner:<userId>:name） */
  key: string;
  /** 展示名（自报 name 或 ownerUsername） */
  title: string;
  /** 对方主体类型：owner=对方 Owner 本人 / agent=对方 Agent */
  kind: "owner" | "agent" | "observe" | "task";
  /** from.role 原样（avatar/worker/coder/owner…，端侧徽章用） */
  role?: string;
}

/** 单条会话消息（本地流水；dir=出/入） */
export interface ChatMessage {
  id: string;
  /** 本地时间戳（epoch ms） */
  at: number;
  dir: "out" | "in";
  text: string;
  /** 入向：发送方快照（渲染气泡头像/名字）；出向缺省=我 */
  from?: {
    name?: string;
    device?: string;
    role?: string;
    agentId?: string;
    ownerUsername?: string;
  };
  /** 关联 Hub 消息 id（out=发送 id，in=inbox 条目 id；本地补偿消息可缺省） */
  hubId?: string;
  /** 投递回执快照（out 向：send ack 的 ok/detail；降级 mail 时注明） */
  ack?: {
    ok: boolean;
    detail?: string;
    delivery?: "injected" | "mailed" | "delivered" | "failed";
  };
  /** 系统事件行（真实注入 settle；非用户文本） */
  kind?: "system";
  /** 协议引用链（autoReply 回信/收件箱 wire 自带；历史消息无此字段不渲染） */
  replyTo?: string;
  /** 任务段 id（observe 回合分组用；无则归「未关联任务」） */
  taskId?: string;
  parentTaskId?: string;
}

/** 会话索引条目 */
export interface ConversationEntry {
  peer: PeerRef;
  lastAt: number;
  lastText: string;
  unread: number;
  archivedAt?: number;
  pinnedAt?: number;
  /** 末条方向（列表行「我:」前缀与状态微标用） */
  lastDir?: "out" | "in";
  /** 末条出向投递快照（列表行状态微标：处理中/失败等） */
  lastAck?: {
    ok: boolean;
    detail?: string;
    delivery?: "injected" | "mailed" | "delivered" | "failed";
  };
}

export interface ChatSearchOptions {
  includeArchived?: boolean;
  limit?: number;
  signal?: AbortSignal;
}

export interface ChatSearchResult {
  peer: PeerRef;
  message: ChatMessage;
  summary: string;
  archived: boolean;
}

const MAX_MSG_TEXT = 8_000; // 单条正文截断（防异常大消息撑爆索引/文件）
const INDEX_DEBOUNCE_MS = 250;

export interface ConversationStoreEvent {
  kind: "append" | "read" | "ack-update" | "conversation-changed";
  peerKey: string;
  message?: ChatMessage;
}

export class ConversationStore {
  private readonly dir: string;
  private readonly listeners = new Set<(e: ConversationStoreEvent) => void>();

  subscribe(listener: (e: ConversationStoreEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ConversationStoreEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 单监听器异常不拖垮其他订阅
      }
    }
  }
  private indexCache: Map<string, ConversationEntry> | null = null;
  private indexDirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    homeDir: string,
    private readonly log: (msg: string) => void,
  ) {
    this.dir = join(homeDir, "conversations");
    void mkdir(this.dir, { recursive: true }).catch(() => {});
  }

  // ---- 索引 ----

  private async loadIndex(): Promise<Map<string, ConversationEntry>> {
    if (this.indexCache) return this.indexCache;
    const map = new Map<string, ConversationEntry>();
    try {
      const raw = await readFile(join(this.dir, "conversations.json"), "utf8");
      const entries = JSON.parse(raw) as ConversationEntry[];
      for (const e of entries) map.set(e.peer.key, e);
    } catch {
      /* 首启/损坏：空索引起步 */
    }
    this.indexCache = map;
    return map;
  }

  private scheduleFlush(): void {
    this.indexDirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush().catch(() => undefined);
    }, INDEX_DEBOUNCE_MS);
    this.flushTimer.unref?.();
  }

  private async flush(): Promise<void> {
    if (!this.indexDirty || !this.indexCache) return;
    this.indexDirty = false;
    const path = join(this.dir, "conversations.json");
    const tmp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify([...this.indexCache.values()], null, 1), "utf8");
      await rename(tmp, path);
    } catch (error) {
      this.indexDirty = true;
      this.log(`[chat] 会话索引落盘失败: ${String(error)}`);
      throw error;
    }
  }

  // ---- 文件名安全化 ----

  private fileFor(peerKey: string): string {
    const safe = peerKey.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
    return join(this.dir, `${safe}.jsonl`);
  }

  // ---- 写 ----

  /** 追加一条消息并更新索引（unread 仅入向递增） */
  async append(peer: PeerRef, msg: ChatMessage): Promise<void> {
    const text = msg.text.length > MAX_MSG_TEXT ? `${msg.text.slice(0, MAX_MSG_TEXT)}…` : msg.text;
    const line = JSON.stringify({ ...msg, text });
    const file = this.fileFor(peer.key);
    // jsonl 逐行 append：Node 无 O_APPEND 直写便捷 API，读改写在此量级（个人会话）可接受
    let existing = "";
    try {
      existing = await readFile(file, "utf8");
    } catch {
      /* 新会话 */
    }
    if (
      msg.hubId &&
      existing.split("\n").some((raw) => {
        try {
          return (JSON.parse(raw) as ChatMessage).hubId === msg.hubId;
        } catch {
          return false;
        }
      })
    )
      return;
    await writeFile(
      file,
      `${existing}${existing.endsWith("\n") || existing === "" ? "" : "\n"}${line}\n`,
      "utf8",
    );
    const idx = await this.loadIndex();
    const prev = idx.get(peer.key);
    idx.set(peer.key, {
      peer,
      lastAt: msg.at,
      lastText: text.length > 120 ? `${text.slice(0, 120)}…` : text,
      unread: (prev?.unread ?? 0) + (msg.dir === "in" ? 1 : 0),
      ...(prev?.pinnedAt !== undefined ? { pinnedAt: prev.pinnedAt } : {}),
      // 列表行状态层（「我:」前缀 + 出向状态微标）：入向后出向状态即过时，置空
      lastDir: msg.dir,
      lastAck: msg.dir === "out" ? msg.ack : undefined,
    });
    this.scheduleFlush();
    this.emit({ kind: "append", peerKey: peer.key, message: { ...msg, text } });
  }

  // ---- 读 ----

  /** 会话索引列表（置顶优先，其余按 lastAt 降序；归档默认隐藏） */
  async list(options: { includeArchived?: boolean } = {}): Promise<ConversationEntry[]> {
    const idx = await this.loadIndex();
    return [...idx.values()]
      .filter((entry) => options.includeArchived || entry.archivedAt === undefined)
      .sort((a, b) => {
        const pinned = Number(b.pinnedAt !== undefined) - Number(a.pinnedAt !== undefined);
        return pinned || b.lastAt - a.lastAt;
      });
  }

  /** 某会话的消息流（tail 条） */
  async history(peerKey: string, tail = 200): Promise<ChatMessage[]> {
    try {
      const raw = await readFile(this.fileFor(peerKey), "utf8");
      const lines = raw.split("\n").filter((l) => l.trim().length > 0);
      const messages = lines.slice(-tail).map((l) => JSON.parse(l) as ChatMessage);
      return applyAckUpdates(messages);
    } catch {
      return [];
    }
  }

  async taskMessages(rootTaskId: string): Promise<ChatMessage[]> {
    const messages = await this.history(`task:${rootTaskId}`, 1000);
    const seen = new Set<string>();
    return messages.filter((message) => {
      const key = message.hubId ?? message.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async appendTaskMessage(message: ChatMessage): Promise<void> {
    if (!message.taskId) return;
    let rootTaskId = message.parentTaskId ?? message.taskId;
    if (message.parentTaskId) {
      const entries = await this.list({ includeArchived: true });
      const known = (
        await Promise.all(
          entries
            .filter((entry) => entry.peer.kind === "task")
            .map((entry) => this.history(entry.peer.key, 1000)),
        )
      ).flat();
      const visited = new Set<string>();
      let current = rootTaskId;
      while (!visited.has(current)) {
        visited.add(current);
        const link = known.find((candidate) => candidate.taskId === current);
        if (!link?.parentTaskId) break;
        current = link.parentTaskId;
      }
      rootTaskId = current;
    }
    await this.append(
      { key: `task:${rootTaskId}`, title: `任务 ${rootTaskId}`, kind: "task" },
      message,
    );
  }

  /** 打开会话页：清未读 */
  async markRead(peerKey: string): Promise<void> {
    const idx = await this.loadIndex();
    const e = idx.get(peerKey);
    if (e && e.unread > 0) {
      e.unread = 0;
      this.scheduleFlush();
      this.emit({ kind: "read", peerKey });
    }
  }

  /**
   * 投递回执修正（UI v2 P1 ack-update）：快速受理后注入失败时追加修正行，
   * history 聚合按 hubId latter-wins 覆盖原始 ack。
   */
  async appendAckUpdate(
    peerKey: string,
    hubId: string,
    ack: {
      ok: boolean;
      detail?: string;
      delivery?: "injected" | "mailed" | "delivered" | "failed";
    },
  ): Promise<void> {
    const line = JSON.stringify({ type: "ack-update", hubId, ack, at: Date.now() });
    const file = this.fileFor(peerKey);
    let existing = "";
    try {
      existing = await readFile(file, "utf8");
    } catch {
      return; // 会话不存在（对端清理竞态）：忽略
    }
    const sep = existing === "" || existing.endsWith("\n") ? "" : "\n";
    await writeFile(file, `${existing}${sep}${line}\n`, "utf8");
    const idx = await this.loadIndex();
    const e = idx.get(peerKey);
    const history = await this.history(peerKey);
    const latestOut = history.toReversed().find((message) => message.dir === "out");
    if (e && latestOut?.hubId === hubId) {
      e.lastAck = ack;
      this.scheduleFlush();
    }
    this.emit({ kind: "ack-update", peerKey });
  }

  private async updateConversation(
    peerKey: string,
    update: (entry: ConversationEntry) => ConversationEntry,
  ): Promise<boolean> {
    const idx = await this.loadIndex();
    const current = idx.get(peerKey);
    if (!current) return false;
    idx.set(peerKey, update(current));
    this.indexDirty = true;
    try {
      await this.flush();
    } catch (error) {
      idx.set(peerKey, current);
      throw error;
    }
    this.emit({ kind: "conversation-changed", peerKey });
    return true;
  }

  async setArchived(peerKey: string, archived: boolean): Promise<boolean> {
    return this.updateConversation(peerKey, (entry) => ({
      ...entry,
      archivedAt: archived ? Date.now() : undefined,
    }));
  }

  async setPinned(peerKey: string, pinned: boolean): Promise<boolean> {
    return this.updateConversation(peerKey, (entry) => ({
      ...entry,
      pinnedAt: pinned ? Date.now() : undefined,
    }));
  }

  async deleteConversation(peerKey: string): Promise<boolean> {
    const idx = await this.loadIndex();
    const current = idx.get(peerKey);
    if (!current) return false;
    idx.delete(peerKey);
    this.indexDirty = true;
    try {
      await this.flush();
      await unlink(this.fileFor(peerKey)).catch((error: unknown) => {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
      });
    } catch (error) {
      idx.set(peerKey, current);
      this.indexDirty = true;
      throw error;
    }
    this.emit({ kind: "conversation-changed", peerKey });
    return true;
  }

  private async readMessages(peerKey: string): Promise<ChatMessage[]> {
    try {
      const raw = await readFile(this.fileFor(peerKey), "utf8");
      const messages: ChatMessage[] = [];
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          messages.push(JSON.parse(line) as ChatMessage);
        } catch {
          // 单行损坏不影响其他真实消息检索
        }
      }
      return applyAckUpdates(messages);
    } catch {
      return [];
    }
  }

  async searchMessages(
    query: string,
    options: ChatSearchOptions = {},
  ): Promise<ChatSearchResult[]> {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle || options.signal?.aborted) return [];
    const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 50)));
    const entries = await this.list({ includeArchived: options.includeArchived === true });
    const results: ChatSearchResult[] = [];
    for (const entry of entries) {
      if (options.signal?.aborted) break;
      const messages = await this.readMessages(entry.peer.key);
      for (const message of messages) {
        if (!message.text.toLocaleLowerCase().includes(needle)) continue;
        const summary = message.text.length > 120 ? `${message.text.slice(0, 120)}…` : message.text;
        results.push({
          peer: entry.peer,
          message,
          summary,
          archived: entry.archivedAt !== undefined,
        });
      }
    }
    return results.sort((a, b) => b.message.at - a.message.at).slice(0, limit);
  }

  async historyAround(
    peerKey: string,
    messageId: string,
    context = 40,
  ): Promise<ChatMessage[] | null> {
    const messages = await this.readMessages(peerKey);
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return null;
    const radius = Math.min(100, Math.max(0, Math.floor(context)));
    return messages.slice(Math.max(0, index - radius), index + radius + 1);
  }

  /** 全部未读合计（通知桥/红点用） */
  async totalUnread(): Promise<number> {
    const idx = await this.loadIndex();
    let n = 0;
    for (const e of idx.values()) n += e.unread;
    return n;
  }
}

/** ack-update 修正聚合：按 hubId latter-wins 覆盖原始 ack（修正行本身剔除） */
function applyAckUpdates(messages: ChatMessage[]): ChatMessage[] {
  interface AckUpdateRow {
    type: "ack-update";
    hubId: string;
    ack: {
      ok: boolean;
      detail?: string;
      delivery?: "injected" | "mailed" | "delivered" | "failed";
    };
    at: number;
  }
  const updates = new Map<
    string,
    {
      ok: boolean;
      detail?: string;
      delivery?: "injected" | "mailed" | "delivered" | "failed";
    }
  >();
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const row = m as unknown as AckUpdateRow;
    if (row && row.type === "ack-update" && typeof row.hubId === "string") {
      updates.set(row.hubId, row.ack);
      continue;
    }
    out.push(m);
  }
  if (updates.size === 0) return out;
  // 逐条复制写入（copy-on-write 保持不变），避免 map 内展开分配
  const patched: ChatMessage[] = [];
  for (const m of out) {
    if (m.hubId && updates.has(m.hubId)) patched.push({ ...m, ack: updates.get(m.hubId) });
    else patched.push(m);
  }
  return patched;
}
