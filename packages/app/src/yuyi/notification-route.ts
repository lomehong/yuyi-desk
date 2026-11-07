import type { YuyiChatEntry } from "@/yuyi/api";
import type { WeChatSelectedPeer } from "@/stores/wechat-mode-store";

export function resolveNotificationPeer(
  peerKey: string,
  conversations: YuyiChatEntry[],
): WeChatSelectedPeer | null {
  const conversation = conversations.find((entry) => entry.peer.key === peerKey);
  return conversation ? { ...conversation.peer } : null;
}
