/**
 * 御驿桌面帧（fork M2e）——「容器 + 卡片」窗口形态。
 *
 * 仅 Tauri 壳激活（isYuyiTauriShell）。结构：
 *   ┌ 容器（最深底色）────────────────────────────┐
 *   │ [☰] 顶栏（拖动区）                  ─ □ ✕ │ ← DesktopWindowControls 绝对定位浮于右上
 *   │ [侧栏(容器色)] 缝 [圆角卡片(surface0)]       │
 *   └──────────────────────────────────────────┘
 *
 * 用法（_layout.tsx）：以 YuyiShellFrame 包住原 workspaceChrome 的行；
 * YuyiShellTopbar 渲染顶栏（含侧栏开关）；YuyiContentCard 包内容区。
 */
import { useCallback, useEffect, type ReactNode } from "react";
import { Image, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { PressHighlight } from "@/components/ui/press-highlight";
import { WindowSidebarMenuToggle } from "@/components/headers/sidebar-menu-toggle";
import { WindowChromeRegion } from "@/utils/desktop-window";
import { isYuyiTauriShell } from "@/yuyi/tauri-bridge";
import { ModeSwitch } from "@/components/wechat/mode-switch";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { topLevelModeStore } from "@/stores/wechat-mode-store";
import { useHosts } from "@/runtime/host-runtime";
import { createYuyiClient } from "@/yuyi/api";
import { resolveNotificationPeer } from "@/yuyi/notification-route";
import { router } from "expo-router";

/** 卡片与容器边缘的缝宽（顶栏下方、右、下、内容与侧栏之间） */
const FRAME_GAP = 8;
/** 顶栏高度 */
export const YUYI_TOPBAR_HEIGHT = 40;
/** 内容卡片圆角 */
const CARD_RADIUS = 14;

export { isYuyiTauriShell };

/** 顶栏拖动：按在纯条区域（非按钮）时调 Tauri startDragging */
function useTopBarDrag() {
  return useCallback((event: { target: unknown; currentTarget: unknown }) => {
    if (event.target !== event.currentTarget) return;
    const tauri = (globalThis as Record<string, unknown>).__TAURI__ as
      | { window?: { getCurrentWindow?: () => { startDragging?: () => Promise<void> } } }
      | undefined;
    const win = tauri?.window?.getCurrentWindow?.();
    void win?.startDragging?.();
  }, []);
}

/** 侧栏收起/展开开关（驱动 panel-store 的桌面 agent 列表开合） */
export function YuyiSidebarToggle() {
  const { t } = useTranslation();
  const onPress = useCallback(() => {
    void (async () => {
      const { usePanelStore } = await import("@/stores/panel-store");
      usePanelStore.getState().toggleDesktopAgentList();
    })();
  }, []);
  return (
    <PressHighlight onPress={onPress} style={styles.toggle} testID="yuyi-sidebar-toggle">
      <Image
        source={require("../../assets/images/yuyi-logo.png")}
        resizeMode="contain"
        style={styles.toggleLogo}
      />
      <Text style={styles.toggleLabel}>{t("yuyi.title")}</Text>
    </PressHighlight>
  );
}

function useNotificationOpenRoute(): void {
  const hosts = useHosts();
  const host = hosts[0];
  useEffect(() => {
    if (!host || !isYuyiTauriShell()) return;
    const listen = (
      globalThis as Record<string, unknown> as {
        __TAURI__?: {
          event?: {
            listen?: <T>(
              name: string,
              handler: (event: { payload: T }) => void,
            ) => Promise<() => void>;
          };
        };
      }
    ).__TAURI__?.event?.listen;
    if (!listen) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<{ peerKey?: string }>("yuyi:notification-open", (event) => {
      const peerKey = event.payload.peerKey;
      if (!peerKey) return;
      void createYuyiClient(host)
        .chats.fetchChatList()
        .then((conversations) => {
          const peer = resolveNotificationPeer(peerKey, conversations);
          if (cancelled || !peer) return undefined;
          topLevelModeStore.set("wechat");
          topLevelModeStore.selectPeer(peer);
          router.push(`/h/${host.serverId}/wechat` as never);
          return undefined;
        })
        .catch(() => undefined);
    }).then((cleanup) => {
      if (cancelled) cleanup();
      else unlisten = cleanup;
      return undefined;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [host]);
}

/** 顶栏：左=侧栏开关 + 模式切换，右=窗口三键（DesktopWindowControls 由 _layout 绝对定位渲染） */
export function YuyiShellTopbar() {
  const onPointerDown = useTopBarDrag();
  useNotificationOpenRoute();
  const handleModeChange = useCallback((next: "workbench" | "wechat") => {
    topLevelModeStore.set(next);
    const host = resolveTopbarServerId();
    if (next === "wechat") {
      if (host && !window.location.pathname.endsWith("/wechat")) {
        router.push(`/h/${host}/wechat` as never);
      }
    } else if (host && window.location.pathname.endsWith("/wechat")) {
      // 回工作台默认路由（HostIndexRoute 解析到最后工作区/开项目）
      router.push(`/h/${host}` as never);
    }
  }, []);
  useKeyboardActionHandler({
    handlerId: "yuyi-top-level-modes",
    actions: ["mode.workbench", "mode.wechat"],
    enabled: true,
    priority: 100,
    handle: (action) => {
      if (action.id === "mode.workbench") {
        handleModeChange("workbench");
        return true;
      }
      if (action.id === "mode.wechat") {
        handleModeChange("wechat");
        return true;
      }
      return false;
    },
  });
  return (
    <View style={styles.topbar} onPointerDown={onPointerDown} testID="yuyi-topbar">
      <YuyiSidebarToggle />
      <View style={styles.modeSwitchSlot}>
        <ModeSwitch onModeChange={handleModeChange} />
      </View>
      <WindowSidebarMenuToggle
        testID="yuyi-sidebar-menu-toggle"
        nativeID="yuyi-sidebar-menu-toggle"
      />
      <View style={styles.topbarSpacer} />
    </View>
  );
}

/** 顶栏模式切换的路由目标：从当前路径解析 serverId */
function resolveTopbarServerId(): string | null {
  const match = /\/h\/([^/]+)/.exec(window.location.pathname);
  return match?.[1] ?? null;
}

/** 内容圆角卡片（把原内容区包进卡片；缝隙即容器底色） */
export function YuyiContentCard({ children }: { children: ReactNode }) {
  return (
    <View style={styles.cardSlot}>
      {/* yuyi fork (M2e)：窗口三键只在壳顶栏（卡片之外），卡片内容不需要为它们
          预留右上避让——收窄 corner 所有权，让卡片内 header 动作贴卡片右缘。 */}
      <WindowChromeRegion corners="none">
        <View style={styles.card}>{children}</View>
      </WindowChromeRegion>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  topbar: {
    height: YUYI_TOPBAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    backgroundColor: theme.colors.surfaceSidebar,
  },
  modeSwitchSlot: {
    flexShrink: 0,
  },
  topbarSpacer: {
    flex: 1,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 9,
    paddingHorizontal: 12,
    height: 32,
    marginLeft: 4,
    borderRadius: theme.borderRadius.lg,
  },
  toggleLogo: {
    width: 20,
    height: 20,
  },
  toggleLabel: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: 0.1,
  },
  cardSlot: {
    flex: 1,
    // 容器底色与顶栏一致：缝隙不透 WebView 白底（圆角外白边的根源）
    backgroundColor: theme.colors.surfaceSidebar,
    paddingLeft: FRAME_GAP,
    paddingRight: FRAME_GAP,
    paddingTop: FRAME_GAP,
    paddingBottom: FRAME_GAP,
  },
  card: {
    flex: 1,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    overflow: "hidden",
    backgroundColor: theme.colors.surface0,
  },
}));
