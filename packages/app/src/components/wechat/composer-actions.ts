import { draftStore } from "@/stores/wechat-draft-store";

export function quoteReplyDraft(currentDraft: string, replyText: string): string {
  const excerpt = replyText.length > 80 ? `${replyText.slice(0, 80)}…` : replyText;
  return currentDraft ? `> ${excerpt}\n\n${currentDraft}` : `> ${excerpt}`;
}

export function clearDraftForPeer(peerKey: string): void {
  draftStore.clear(peerKey);
}
