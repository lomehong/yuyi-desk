import type { YuyiChatEntry } from "@/yuyi/api";
import type { WeChatSelectedPeer } from "@/stores/wechat-mode-store";

export type NotificationTarget =
  | { type: "peer"; peer: WeChatSelectedPeer }
  | { type: "task"; rootTaskId: string; title: string }
  | { type: "approval"; approvalId: string; peerKey?: string };

export function resolveNotificationTarget(
  peerKey: string,
  conversations: YuyiChatEntry[],
  approvalId?: string,
): NotificationTarget | null {
  const resolvedApprovalId =
    approvalId ?? (peerKey.startsWith("approval:") ? peerKey.slice(9) : undefined);
  if (resolvedApprovalId) {
    return {
      type: "approval",
      approvalId: resolvedApprovalId,
      ...(peerKey.startsWith("approval:") ? {} : { peerKey }),
    };
  }
  const conversation = conversations.find((entry) => entry.peer.key === peerKey);
  if (!conversation) return null;
  if (conversation.peer.kind === "task" && peerKey.startsWith("task:")) {
    return { type: "task", rootTaskId: peerKey.slice(5), title: conversation.peer.title };
  }
  return { type: "peer", peer: { ...conversation.peer } };
}

export function resolveNotificationPeer(
  peerKey: string,
  conversations: YuyiChatEntry[],
): WeChatSelectedPeer | null {
  const target = resolveNotificationTarget(peerKey, conversations);
  return target?.type === "peer" ? target.peer : null;
}
