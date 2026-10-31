/**
 * 御驿 Tauri 桥垫片（fork M2e）。
 *
 * Tauri 壳（apps/desktop）在 web 环境暴露 window.__TAURI__（withGlobalTauri）。
 * 本垫片把它适配成 app 内建自定义窗口 chrome 所期望的 Electron 桥最小面
 * （window.paseoDesktop：platform / windowChromeMode / window bridge），
 * 从而点亮 DesktopWindowControls（右上三键）、内容双圆角、顶栏安全区等
 * 既有机制——不改 app 的 chrome 判定代码。
 *
 * 必须在 getIsElectron() 首次判定前安装（index.ts 顶部 side-effect import）。
 */

interface TauriWindow {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
  startDragging: () => Promise<void>;
  onResized: (handler: () => void) => Promise<() => void>;
}

function getTauriWindow(): TauriWindow | null {
  const tauri = (globalThis as Record<string, unknown>).__TAURI__ as
    | { window?: { getCurrentWindow?: () => unknown } }
    | undefined;
  const getter = tauri?.window?.getCurrentWindow;
  if (typeof getter !== "function") {
    return null;
  }
  try {
    return (getter() ?? null) as TauriWindow;
  } catch {
    return null;
  }
}

function isTauriRuntime(): boolean {
  return getTauriWindow() !== null;
}

/** Electron DesktopWindowBridge 的 Tauri 适配（onResized 用轮询合成） */
function createWindowBridge() {
  const tw = () => getTauriWindow();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();
  let last = { fullscreen: false, maximized: false };

  async function sample() {
    const w = tw();
    if (!w) return;
    try {
      const [fullscreen, maximized] = await Promise.all([w.isFullscreen(), w.isMaximized()]);
      if (fullscreen !== last.fullscreen || maximized !== last.maximized) {
        last = { fullscreen, maximized };
        for (const fn of listeners) fn();
      }
    } catch {
      // window gone / webview tearing down — ignore
    }
  }

  return {
    minimize: async () => void tw()?.minimize(),
    close: async () => void tw()?.close(),
    toggleMaximize: async () => void tw()?.toggleMaximize(),
    isMaximized: async () => (await tw()?.isMaximized()) ?? false,
    isFullscreen: async () => (await tw()?.isFullscreen()) ?? false,
    startDragging: async () => void tw()?.startDragging(),
    onResized: (handler: () => void) => {
      listeners.add(handler);
      if (!pollTimer) {
        pollTimer = setInterval(() => void sample(), 1000);
      }
      return () => {
        listeners.delete(handler);
        if (listeners.size === 0 && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      };
    },
  };
}

/** 安装垫片；非 Tauri 环境为 no-op。幂等。 */
export function installTauriDesktopBridge(): void {
  const w = globalThis as Record<string, unknown>;
  if (!isTauriRuntime() || w.paseoDesktop) {
    return;
  }
  w.paseoDesktop = {
    platform: navigator.userAgent.includes("Mac OS") ? "darwin" : "windows",
    windowChromeMode: "custom-windows",
    window: { getCurrentWindow: createWindowBridge },
  };
}

/** Tauri 壳是否激活（顶栏/帧布局的使用条件；web/Electron/移动均为 false） */
export function isYuyiTauriShell(): boolean {
  if ((globalThis as Record<string, unknown>).__YUYI_SHELL_CACHED__ !== undefined) {
    return (globalThis as Record<string, unknown>).__YUYI_SHELL_CACHED__ as boolean;
  }
  const result = isTauriRuntime();
  (globalThis as Record<string, unknown>).__YUYI_SHELL_CACHED__ = result;
  return result;
}

// side-effect import 即安装（index.ts 顶部 import 本模块的目的）
installTauriDesktopBridge();
