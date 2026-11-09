import type { YuyiChatEntry, YuyiChatMessage, YuyiPeersEntry, YuyiStatus } from "@/yuyi/api";
import type { WeChatSelectedPeer } from "@/stores/wechat-mode-store";
import { canonicalPeerKey } from "./wechat-model";

export function splitUnreadMessages(
  messages: YuyiChatMessage[],
  unread: number,
): { read: YuyiChatMessage[]; unread: YuyiChatMessage[] } {
  const count = Math.max(0, Math.min(messages.length, Math.floor(unread)));
  return {
    read: messages.slice(0, messages.length - count),
    unread: messages.slice(messages.length - count),
  };
}

export function nextConversationKey(
  rows: YuyiChatEntry[],
  currentKey: string | null,
  delta: 1 | -1,
): string | null {
  const keys = rows.filter((row) => row.peer.kind !== "observe").map((row) => row.peer.key);
  if (keys.length === 0) return null;
  const current = keys.indexOf(currentKey ?? "");
  if (current < 0) return delta > 0 ? keys[0]! : keys[keys.length - 1]!;
  return keys[(current + delta + keys.length) % keys.length]!;
}

export function isPeerStillAvailable(
  peer: WeChatSelectedPeer,
  conversations: YuyiChatEntry[],
  peers: YuyiPeersEntry[] | null,
  status: YuyiStatus | null,
): boolean {
  if (conversations.some((conversation) => conversation.peer.key === peer.key)) return true;
  for (const entry of peers ?? []) {
    for (const session of entry.sessions) {
      if (canonicalPeerKey(entry.agentId, session.name) === peer.key) return true;
    }
  }
  return (status?.bindings ?? []).some(
    (binding) => canonicalPeerKey(binding.agentId, binding.name) === peer.key,
  );
}
