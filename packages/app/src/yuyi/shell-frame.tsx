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
import { useCallback, type ReactNode } from "react";
import { Image, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { PressHighlight } from "@/components/ui/press-highlight";
import { WindowChromeRegion } from "@/utils/desktop-window";
import { isYuyiTauriShell } from "@/yuyi/tauri-bridge";

/** 卡片与容器边缘的缝宽（顶栏下方、右、下、内容与侧栏之间） */
const FRAME_GAP = 6;
/** 顶栏高度 */
export const YUYI_TOPBAR_HEIGHT = 36;
/** 内容卡片圆角 */
const CARD_RADIUS = 12;

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
      <Image source={require("../../assets/images/yuyi-logo.png")} style={styles.toggleLogo} />
      <Text style={styles.toggleLabel}>{t("yuyi.title")}</Text>
    </PressHighlight>
  );
}

/** 顶栏：左=侧栏开关，右=窗口三键（DesktopWindowControls 由 _layout 绝对定位渲染） */
export function YuyiShellTopbar() {
  const onPointerDown = useTopBarDrag();
  return (
    <View style={styles.topbar} onPointerDown={onPointerDown} testID="yuyi-topbar">
      <YuyiSidebarToggle />
      <View style={styles.topbarSpacer} />
    </View>
  );
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
    backgroundColor: theme.colors.surfaceSidebar,
  },
  topbarSpacer: {
    flex: 1,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    height: "100%",
  },
  toggleLogo: {
    width: 18,
    height: 18,
    resizeMode: "contain",
  },
  toggleLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
  },
  cardSlot: {
    flex: 1,
    paddingLeft: FRAME_GAP,
    paddingRight: FRAME_GAP,
    paddingTop: FRAME_GAP,
    paddingBottom: FRAME_GAP,
  },
  card: {
    flex: 1,
    borderRadius: CARD_RADIUS,
    overflow: "hidden",
    backgroundColor: theme.colors.surface0,
  },
}));
