import { useSyncExternalStore } from "react";
import { isWeb } from "@/constants/platform";

/**
 * 顶层模式（「Agent 微信」UI 重构）：工作台（现有三栏）与微信（IM 布局）两个
 * 平级顶层模式，标题栏左上角分段切换。持久化记住上次所在模式（启动时
 * HostIndexRoute 据此重定向）。
 */

export type AppTopLevelMode = "workbench" | "wechat";

const STORAGE_KEY = "yuyi:top-level-mode";
const PEER_STORAGE_KEY = "yuyi:wechat-selected-peer";

/** 微信模式内选中的会话（左栏 ↔ 主区共享；切模式后保留） */
export interface WeChatSelectedPeer {
  key: string;
  title: string;
  kind: string;
  serverId?: string;
}

export interface WeChatMessageTarget {
  serverId: string;
  peerKey: string;
  messageId: string;
  title?: string;
  kind?: string;
}

export type WeChatConversationFilter = "all" | "local" | "archived";

function readStoredPeer(): WeChatSelectedPeer | null {
  if (!isWeb) return null;
  try {
    const raw = window.localStorage.getItem(PEER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WeChatSelectedPeer>;
    if (
      typeof parsed.key !== "string" ||
      typeof parsed.title !== "string" ||
      typeof parsed.kind !== "string"
    )
      return null;
    return {
      key: parsed.key,
      title: parsed.title,
      kind: parsed.kind,
      ...(typeof parsed.serverId === "string" ? { serverId: parsed.serverId } : {}),
    };
  } catch {
    return null;
  }
}

function writeStoredPeer(peer: WeChatSelectedPeer | null): void {
  if (!isWeb) return;
  try {
    if (peer) window.localStorage.setItem(PEER_STORAGE_KEY, JSON.stringify(peer));
    else window.localStorage.removeItem(PEER_STORAGE_KEY);
  } catch {
    // 存储不可用时仍在当前会话内保持
  }
}

const MUTE_STORAGE_KEY = "yuyi:wechat-muted-peers";

function readStoredMutedPeers(): string[] {
  if (!isWeb) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MUTE_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function writeStoredMutedPeers(peers: Set<string>): void {
  if (!isWeb) return;
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, JSON.stringify([...peers]));
  } catch {
    // 存储不可用时仅在当前会话内保持
  }
}

let mode: AppTopLevelMode = readStoredMode();
let selectedPeer: WeChatSelectedPeer | null = readStoredPeer();
let selectedTask: { rootTaskId: string; title: string; serverId?: string } | null = null;
let selectedApprovalId: string | null = null;
const mutedPeers = new Set(readStoredMutedPeers());
const listeners = new Set<() => void>();

function readStoredMode(): AppTopLevelMode {
  if (!isWeb) return "workbench";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "wechat" ? "wechat" : "workbench";
  } catch {
    return "workbench";
  }
}

function writeStoredMode(next: AppTopLevelMode): void {
  if (!isWeb) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 存储不可用（隐私模式等）：模式仍在会话内生效，仅不跨启动
  }
}

function setMode(next: AppTopLevelMode): void {
  if (mode === next) return;
  mode = next;
  writeStoredMode(next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let observeExpanded = false;
let observeTouched = false;
let sidebarSearch = "";
let directoryOpen = false;
let directoryFilter = "";
let searchFocusVersion = 0;
let messageTarget: WeChatMessageTarget | null = null;
let conversationFilter: WeChatConversationFilter = "all";
const scrollPositions = new Map<string, number>();

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

export const topLevelModeStore = {
  get: () => mode,
  set: setMode,
  subscribe,
  getPeer: () => selectedPeer,
  selectPeer(peer: WeChatSelectedPeer | null): void {
    const taskChanged = selectedTask !== null || selectedApprovalId !== null;
    if (
      selectedPeer?.key === peer?.key &&
      selectedPeer?.serverId === peer?.serverId &&
      !taskChanged
    )
      return;
    selectedTask = null;
    selectedApprovalId = null;
    selectedPeer = peer;
    writeStoredPeer(peer);
    for (const listener of listeners) listener();
  },
  selectTask(task: { rootTaskId: string; title: string; serverId?: string } | null): void {
    selectedTask = task;
    selectedApprovalId = null;
    selectedPeer = null;
    writeStoredPeer(null);
    for (const listener of listeners) listener();
  },
};

export function useWeChatSelectedPeer(): WeChatSelectedPeer | null {
  return useSyncExternalStore(subscribe, () => selectedPeer);
}

export function useWeChatSelectedTask(): {
  rootTaskId: string;
  title: string;
  serverId?: string;
} | null {
  return useSyncExternalStore(subscribe, () => selectedTask);
}

export function useWeChatSelectedApproval(): string | null {
  return useSyncExternalStore(subscribe, () => selectedApprovalId);
}

export function usePeerMuted(peerKey: string): boolean {
  return useSyncExternalStore(subscribe, () => mutedPeers.has(peerKey));
}

export function useObserveExpanded(): boolean {
  return useSyncExternalStore(subscribe, () => observeExpanded);
}

export const wechatUiStore = {
  getObserveExpanded: () => observeExpanded,
  setObserveExpanded(v: boolean): void {
    observeTouched = true;
    if (observeExpanded === v) return;
    observeExpanded = v;
    notifyListeners();
  },
  expandObserveForUnread(): void {
    if (observeTouched || observeExpanded) return;
    observeExpanded = true;
    notifyListeners();
  },
  getSearch: () => sidebarSearch,
  setSearch(q: string): void {
    if (sidebarSearch === q) return;
    sidebarSearch = q;
    notifyListeners();
  },
  getDirectoryOpen: () => directoryOpen,
  openDirectory(): void {
    directoryOpen = true;
    notifyListeners();
  },
  closeDirectory(): void {
    if (!directoryOpen) return;
    directoryOpen = false;
    notifyListeners();
  },
  getDirectoryFilter: () => directoryFilter,
  setDirectoryFilter(value: string): void {
    if (directoryFilter === value) return;
    directoryFilter = value;
    notifyListeners();
  },
  getSearchFocusVersion: () => searchFocusVersion,
  focusSearch(): void {
    searchFocusVersion += 1;
    notifyListeners();
  },
  getScrollPosition(peerKey: string): number {
    return scrollPositions.get(peerKey) ?? 0;
  },
  setScrollPosition(peerKey: string, position: number): void {
    scrollPositions.set(peerKey, Math.max(0, position));
  },
  getMessageTarget: () => messageTarget,
  openMessageResult(target: WeChatMessageTarget): void {
    messageTarget = target;
    selectedTask = null;
    selectedPeer = {
      key: target.peerKey,
      title: target.title ?? target.peerKey,
      kind: target.kind ?? "agent",
      serverId: target.serverId,
    };
    writeStoredPeer(selectedPeer);
    notifyListeners();
  },
  clearMessageTarget(): void {
    if (!messageTarget) return;
    messageTarget = null;
    notifyListeners();
  },
  openApproval(approvalId: string): void {
    selectedApprovalId = approvalId;
    selectedTask = null;
    notifyListeners();
  },
  closeApproval(): void {
    if (!selectedApprovalId) return;
    selectedApprovalId = null;
    notifyListeners();
  },
  getConversationFilter: () => conversationFilter,
  setConversationFilter(next: WeChatConversationFilter): void {
    if (conversationFilter === next) return;
    conversationFilter = next;
    notifyListeners();
  },
  isPeerMuted(peerKey: string): boolean {
    return mutedPeers.has(peerKey);
  },
  togglePeerMuted(
    peerKey: string,
    client?: { chats: { setChatMuted: (key: string, muted: boolean) => Promise<void> } },
  ): void {
    const next = !mutedPeers.has(peerKey);
    if (next) mutedPeers.add(peerKey);
    else mutedPeers.delete(peerKey);
    writeStoredMutedPeers(mutedPeers);
    notifyListeners();
    void client?.chats.setChatMuted(peerKey, next).catch(() => undefined);
  },
};

export function useSidebarSearch(): string {
  return useSyncExternalStore(subscribe, () => sidebarSearch);
}

export function useDirectoryOpen(): boolean {
  return useSyncExternalStore(subscribe, () => directoryOpen);
}

export function useDirectoryFilter(): string {
  return useSyncExternalStore(subscribe, () => directoryFilter);
}

export function useSearchFocusVersion(): number {
  return useSyncExternalStore(subscribe, () => searchFocusVersion);
}

export function useMessageTarget(): WeChatMessageTarget | null {
  return useSyncExternalStore(subscribe, () => messageTarget);
}

export function useConversationFilter(): WeChatConversationFilter {
  return useSyncExternalStore(subscribe, () => conversationFilter);
}

export function useTopLevelMode(): AppTopLevelMode {
  return useSyncExternalStore(subscribe, () => mode);
}

/** 启动路由判定用（非响应式读取） */
export function getStoredTopLevelMode(): AppTopLevelMode {
  return mode;
}
