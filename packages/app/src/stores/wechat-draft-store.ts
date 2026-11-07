/**
 * 会话草稿持久化（UI v2 交互 B7）：per-peer 草稿，localStorage 落盘——
 * 切会话/切模式/重启均恢复。发送成功即清除。
 */
import { isWeb } from "@/constants/platform";

const STORAGE_KEY = "yuyi:wechat-drafts";

const drafts = new Map<string, string>(readStored());

function readStored(): [string, string][] {
  if (!isWeb) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.entries(parsed).filter(([k, v]) => k && typeof v === "string");
  } catch {
    return [];
  }
}

function flush(): void {
  if (!isWeb) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(drafts)));
  } catch {
    // 存储不可用：草稿退化为会话内存
  }
}

export const draftStore = {
  get(peerKey: string): string {
    return drafts.get(peerKey) ?? "";
  },
  set(peerKey: string, text: string): void {
    if (text) drafts.set(peerKey, text);
    else drafts.delete(peerKey);
    flush();
  },
  clear(peerKey: string): void {
    drafts.delete(peerKey);
    flush();
  },
};
