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

/** Tauri 2 的 invoke 在 __TAURI__.core.invoke（旧版在顶层，两者都试） */
function getTauriCore(): ((cmd: string, args?: unknown) => Promise<unknown>) | null {
  const tauri = (globalThis as Record<string, unknown>).__TAURI__ as
    | { core?: { invoke?: unknown }; invoke?: unknown }
    | undefined;
  if (typeof tauri?.core?.invoke === "function") {
    return tauri.core.invoke as never;
  }
  if (typeof tauri?.invoke === "function") {
    return tauri.invoke as never;
  }
  return null;
}

function getTauriEventListen():
  | ((event: string, handler: (payload: unknown) => void) => Promise<() => void>)
  | null {
  const tauri = (globalThis as Record<string, unknown>).__TAURI__ as
    | { event?: { listen?: unknown } }
    | undefined;
  return typeof tauri?.event?.listen === "function" ? (tauri.event.listen as never) : null;
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
    invoke: createInvokeBridge(),
    events: {
      on: async (event: string, handler: (payload: unknown) => void) => {
        const listen = getTauriEventListen();
        if (!listen) {
          throw new Error("Desktop event API is unavailable.");
        }
        return await listen(event, handler);
      },
    },
  };
}

/**
 * Electron invoke() 命令面的 Tauri 适配——app 的桌面启动流程
 * （daemon-start-service）靠这几个命令评估设置并拿到 daemon 连接信息。
 * daemon 本体由 Tauri（Rust）拉起；这里只向 web 层如实报告它的状态。
 */
function createInvokeBridge() {
  async function daemonInfo(): Promise<{
    host: string;
    port: number;
    logPath: string;
    home: string;
  }> {
    const invoke = getTauriCore();
    if (!invoke) {
      throw new Error("Tauri invoke unavailable");
    }
    return (await invoke("yuyi_daemon_info")) as never;
  }

  async function daemonStatusResponse(): Promise<unknown> {
    const info = await daemonInfo();
    let serverId = "";
    let hostname = "";
    let version: string | null = null;
    let state: "running" | "stopped" = "stopped";
    let error: string | null = null;
    // daemon 由壳异步拉起，web 层可能先到——轮询等待其就绪（≤30s）
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const res = await fetch(`http://${info.host}:${info.port}/api/status`, {
          signal: AbortSignal.timeout(2000),
        });
        const body = (await res.json()) as {
          serverId?: string;
          hostname?: string;
          version?: string;
        };
        serverId = body.serverId ?? "";
        hostname = body.hostname ?? "";
        version = body.version ?? null;
        if (serverId) {
          state = "running";
          error = null;
          break;
        }
      } catch (e) {
        error = String(e);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return {
      serverId,
      status: state,
      listen: `${info.host}:${info.port}`,
      hostname,
      pid: null,
      home: info.home,
      version,
      desktopManaged: true,
      ownedByDesktop: true,
      startedAt: null,
      error,
    };
  }

  return async function invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
    switch (command) {
      case "get_desktop_settings":
        return {
          daemon: { manageBuiltInDaemon: true, keepRunningAfterQuit: false },
          notifications: { playSound: false },
        };
      case "desktop_daemon_status":
      case "start_desktop_daemon":
      case "stop_desktop_daemon":
      case "restart_desktop_daemon":
        return daemonStatusResponse();
      case "desktop_daemon_logs": {
        const tauriCore = getTauriCore();
        if (!tauriCore) {
          throw new Error("Tauri invoke unavailable");
        }
        return (await tauriCore("yuyi_daemon_log_tail", { maxBytes: 64 * 1024 })) as never;
      }
      case "cli_daemon_status":
        return "running";
      // host-runtime 连接桌面托管 daemon 前读取本地凭证（Electron 由 main 进程读
      // <home>/local-credential；此处转 Tauri 命令，端口校验在 Rust 侧做）
      case "desktop_local_credential": {
        const tauriCore = getTauriCore();
        if (!tauriCore) {
          throw new Error("Tauri invoke unavailable");
        }
        const listen = args?.listen;
        if (typeof listen !== "string") {
          return null;
        }
        return (await tauriCore("yuyi_local_credential", { listen })) as never;
      }
      case "desktop_get_system_idle_time":
      case "garbage_collect_attachment_files": {
        const tauriCore = getTauriCore();
        if (!tauriCore) {
          throw new Error("Tauri invoke unavailable");
        }
        return await tauriCore(command, args);
      }
      default:
        throw new Error(`Desktop command not available in yuyi shell: ${command}`);
    }
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
