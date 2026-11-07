/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Pressable } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toggleStyle = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("@/components/headers/header-toggle-button", () => ({
  HeaderToggleButton: ({
    children,
    onPress,
    testID,
    accessibilityLabel,
    accessibilityState,
    style,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    testID?: string;
    accessibilityLabel?: string;
    accessibilityState?: { expanded: boolean };
    style?: Array<{ marginLeft?: number | { md?: number } } | undefined>;
  }) => {
    toggleStyle.current = style;
    return (
      <Pressable
        onPress={onPress}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
        aria-expanded={accessibilityState?.expanded}
      >
        {children}
      </Pressable>
    );
  },
  headerIconSlotStyle: { slot: {} },
}));

vi.mock("lucide-react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react-native")>();
  return {
    ...actual,
    LayoutGrid: () => React.createElement("span"),
    MessageCircle: () => React.createElement("span"),
    PanelLeft: () => React.createElement("span"),
  };
});

import { i18n } from "@/i18n/i18next";
import { usePanelStore } from "@/stores/panel-store";
import { topLevelModeStore } from "@/stores/wechat-mode-store";
import { KeyboardActionDispatcherProvider } from "@/keyboard/keyboard-action-dispatcher-context";
import { YuyiShellTopbar } from "./shell-frame";

vi.mock("@/runtime/host-runtime", () => ({ useHosts: () => [] }));

describe("YuyiShellTopbar", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
    usePanelStore.setState({
      desktop: { agentListOpen: true, focusModeEnabled: false },
    });
    topLevelModeStore.set("workbench");
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  it("toggles the left menu without negative desktop margins or stealing mode clicks", () => {
    render(
      <KeyboardActionDispatcherProvider>
        <YuyiShellTopbar />
      </KeyboardActionDispatcherProvider>,
    );

    const toggle = screen.getByTestId("yuyi-sidebar-menu-toggle");
    expect(toggleStyle.current).toEqual([{ marginLeft: { xs: 0, md: 0 } }, undefined]);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByTestId("mode-wechat"));
    expect(topLevelModeStore.get()).toBe("wechat");

    fireEvent.click(toggle);
    expect(usePanelStore.getState().desktop.agentListOpen).toBe(false);

    fireEvent.click(toggle);
    expect(usePanelStore.getState().desktop.agentListOpen).toBe(true);
  });
});
