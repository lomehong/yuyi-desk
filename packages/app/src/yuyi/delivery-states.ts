/**
 * 投递状态常量模块（UI v2 状态机，docs/御驿-Agent微信-UI设计-v2/04 §1.3）。
 *
 * 设计底线：状态判定集中此处——daemon 改 detail 文案只动这一个文件；
 * daemon 出结构化 ack 枚举（P1 ack-update）后整体替换。
 * 禁止伪状态：S1「对方处理中」锚定 daemon 真实受理 ack；无佐证宁显 S4。
 */

/** 出向消息投递状态（乐观气泡先入 pending，ack 返回后分流终态） */
export type DeliveryKind =
  | "pending" // S0 发送中（乐观气泡、ack 未定）
  | "injected" // S1 对方处理中（daemon 真实受理）
  | "mailed" // S2 已转对方收件箱（离线降级）
  | "delivered" // S3 已送达
  | "noReply" // S4 已送达·暂无回音（S1 超 90s 诚实降级）
  | "failed"; // S5/S5′ 发送失败（可重试）

export interface DeliveryAck {
  ok: boolean;
  detail?: string;
  delivery?: Exclude<DeliveryKind, "pending" | "noReply">;
}

export interface DeliveryStateOptions {
  hasReply?: boolean;
  peerBusy?: boolean | null;
}

export function classifyDelivery(ack?: DeliveryAck): DeliveryKind {
  if (!ack) return "pending";
  if (ack.delivery) return ack.delivery;
  if (!ack.ok) return "failed";
  const detail = ack.detail ?? "";
  if (/已注入/.test(detail)) return "injected";
  if (/mail|收件箱/i.test(detail)) return "mailed";
  return "delivered";
}

export function messageDeliveryState(
  msg: { dir: "out" | "in"; at?: number; ackAt?: number; ack?: DeliveryAck },
  now: number,
  options: DeliveryStateOptions = {},
): DeliveryKind | null {
  if (msg.dir !== "out") return null;
  const kind = classifyDelivery(msg.ack);
  const elapsed = now - (msg.ackAt ?? msg.at ?? now);
  if (kind === "pending") return elapsed > 8_000 ? "failed" : "pending";
  if (kind !== "injected") return kind;
  if (options.hasReply) return "delivered";
  if (options.peerBusy === false && elapsed > 20_000) return "noReply";
  if (options.peerBusy !== true && elapsed > 90_000) return "noReply";
  return "injected";
}

interface PendingMatch {
  messageId?: string;
  text: string;
  sentAt: number;
}

export function reconcilePendingMessages<T extends PendingMatch>(
  pending: T[],
  messages: Array<{ id: string; at: number; dir: "out" | "in"; text: string }>,
): T[] {
  return pending.filter((item) => {
    if (item.messageId) return !messages.some((message) => message.id === item.messageId);
    return !messages.some(
      (message) =>
        message.dir === "out" &&
        message.text === item.text &&
        Math.abs(message.at - item.sentAt) < 10_000,
    );
  });
}

/** i18n key（词表见 04-状态与实时反馈 §6） */
export const DELIVERY_I18N_KEY: Record<DeliveryKind, string> = {
  pending: "agentChat.msg.sending",
  injected: "agentChat.msg.processing",
  mailed: "agentChat.msg.mailed",
  delivered: "agentChat.msg.delivered",
  noReply: "agentChat.msg.deliveredNoReply",
  failed: "agentChat.msg.failed",
};
