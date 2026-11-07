import type { YuyiChatMessage } from "@/yuyi/api";

export const MESSAGE_GROUP_WINDOW_MS = 5 * 60_000;

export interface MessageGroup {
  id: string;
  messages: YuyiChatMessage[];
  mine: boolean;
  senderName: string;
  senderIsOwner: boolean;
  senderKey: string;
  at: number;
}

function senderName(message: YuyiChatMessage): string {
  return message.from?.ownerUsername || message.from?.name || message.from?.device || "…";
}

function senderKey(message: YuyiChatMessage): string {
  if (message.dir === "out") return "mine";
  const from = message.from;
  return [from?.role, from?.agentId, senderName(message)].join(":");
}

function isSameDay(left: number, right: number): boolean {
  const a = new Date(left);
  const b = new Date(right);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function buildMessageGroups(messages: YuyiChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const message of messages) {
    const previous = groups.at(-1);
    const startsNewGroup =
      !previous ||
      previous.mine !== (message.dir === "out") ||
      previous.senderKey !== senderKey(message) ||
      message.at - previous.at > MESSAGE_GROUP_WINDOW_MS ||
      !isSameDay(message.at, previous.at);
    if (startsNewGroup) {
      groups.push({
        id: message.id,
        messages: [message],
        mine: message.dir === "out",
        senderName: message.dir === "out" ? "" : senderName(message),
        senderIsOwner: message.dir !== "out" && message.from?.role === "owner",
        at: message.at,
        senderKey: senderKey(message),
      });
      continue;
    }
    previous.messages.push(message);
    previous.at = message.at;
  }
  return groups;
}
