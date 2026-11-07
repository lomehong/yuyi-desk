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
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** 会话对端（联系人条目快照，展示用） */
export interface PeerRef {
  /** canonical peerKey（agentId:name 或 owner:<userId>:name） */
  key: string;
  /** 展示名（自报 name 或 ownerUsername） */
  title: string;
  /** 对方主体类型：owner=对方 Owner 本人 / agent=对方 Agent */
  kind: "owner" | "agent" | "observe";
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
  ack?: { ok: boolean; detail?: string };
}

/** 会话索引条目 */
export interface ConversationEntry {
  peer: PeerRef;
  lastAt: number;
  lastText: string;
  unread: number;
}

const MAX_MSG_TEXT = 8_000; // 单条正文截断（防异常大消息撑爆索引/文件）
const INDEX_DEBOUNCE_MS = 250;

export class ConversationStore {
  private readonly dir: string;
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
      void this.flush();
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
      this.log(`[chat] 会话索引落盘失败: ${String(error)}`);
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
    });
    this.scheduleFlush();
  }

  // ---- 读 ----

  /** 会话索引列表（按 lastAt 降序） */
  async list(): Promise<ConversationEntry[]> {
    const idx = await this.loadIndex();
    return [...idx.values()].sort((a, b) => b.lastAt - a.lastAt);
  }

  /** 某会话的消息流（tail 条） */
  async history(peerKey: string, tail = 200): Promise<ChatMessage[]> {
    try {
      const raw = await readFile(this.fileFor(peerKey), "utf8");
      const lines = raw.split("\n").filter((l) => l.trim().length > 0);
      return lines.slice(-tail).map((l) => JSON.parse(l) as ChatMessage);
    } catch {
      return [];
    }
  }

  /** 打开会话页：清未读 */
  async markRead(peerKey: string): Promise<void> {
    const idx = await this.loadIndex();
    const e = idx.get(peerKey);
    if (e && e.unread > 0) {
      e.unread = 0;
      this.scheduleFlush();
    }
  }

  /** 全部未读合计（通知桥/红点用） */
  async totalUnread(): Promise<number> {
    const idx = await this.loadIndex();
    let n = 0;
    for (const e of idx.values()) n += e.unread;
    return n;
  }
}
