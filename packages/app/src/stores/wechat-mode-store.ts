import { useSyncExternalStore } from "react";
import { isWeb } from "@/constants/platform";

/**
 * 顶层模式（「Agent 微信」UI 重构）：工作台（现有三栏）与微信（IM 布局）两个
 * 平级顶层模式，标题栏左上角分段切换。持久化记住上次所在模式（启动时
 * HostIndexRoute 据此重定向）。
 */

export type AppTopLevelMode = "workbench" | "wechat";

const STORAGE_KEY = "yuyi:top-level-mode";

/** 微信模式内选中的会话（左栏 ↔ 主区共享；切模式后保留） */
export interface WeChatSelectedPeer {
  key: string;
  title: string;
  kind: string;
}

let mode: AppTopLevelMode = readStoredMode();
let selectedPeer: WeChatSelectedPeer | null = null;
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

export const topLevelModeStore = {
  get: () => mode,
  set: setMode,
  subscribe,
  getPeer: () => selectedPeer,
  selectPeer(peer: WeChatSelectedPeer | null): void {
    if (selectedPeer?.key === peer?.key) return;
    selectedPeer = peer;
    for (const listener of listeners) listener();
  },
};

export function useWeChatSelectedPeer(): WeChatSelectedPeer | null {
  return useSyncExternalStore(subscribe, () => selectedPeer);
}

export function useTopLevelMode(): AppTopLevelMode {
  return useSyncExternalStore(subscribe, () => mode);
}

/** 启动路由判定用（非响应式读取） */
export function getStoredTopLevelMode(): AppTopLevelMode {
  return mode;
}
