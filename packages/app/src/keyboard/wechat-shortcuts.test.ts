import { afterEach, describe, expect, it } from "vitest";
import { resolveKeyboardShortcut, type KeyboardShortcutInput } from "./keyboard-shortcuts";
import { routeKeyboardShortcut, type ShortcutRoutingContext } from "./route-shortcut";
import { topLevelModeStore } from "@/stores/wechat-mode-store";

function event(key: string, overrides: Partial<KeyboardShortcutInput> = {}): KeyboardShortcutInput {
  return {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    ...overrides,
  };
}

function match(input: KeyboardShortcutInput, focusScope: "other" | "message-input" = "other") {
  return resolveKeyboardShortcut({
    event: input,
    context: { isMac: false, isDesktop: true, focusScope, commandCenterOpen: false },
    chordState: { candidateIndices: [], step: 0, timeoutId: null },
    onChordReset: () => undefined,
  }).match;
}

const routingContext: ShortcutRoutingContext = {
  pathname: "/h/host/wechat",
  isMobile: false,
  sidebarShortcutTargets: [],
  navigationActiveWorkspace: null,
  commandCenterOpen: false,
  shortcutsDialogOpen: false,
};

describe("Agent 微信 shortcuts", () => {
  afterEach(() => {
    topLevelModeStore.set("workbench");
  });

  it("binds search, contact, escape and mode switching", () => {
    expect(match(event("f", { ctrlKey: true }))?.action).toBe("wechat.search.focus");
    expect(match(event("n", { ctrlKey: true }))?.action).toBe("workspace.new");
    expect(match(event("Escape"))?.action).toBe("agent.interrupt");
    expect(match(event("1", { ctrlKey: true, code: "Digit1" }))?.action).toBe("mode.workbench");
    expect(match(event("2", { ctrlKey: true, code: "Digit2" }))?.action).toBe("mode.wechat");
  });

  it("moves conversations with j/k only outside editable surfaces", () => {
    expect(match(event("j"))?.action).toBe("wechat.conv.next");
    expect(match(event("k"))?.action).toBe("wechat.conv.prev");
    expect(match(event("ArrowDown", { altKey: true }))?.action).toBe("wechat.conv.next");
    expect(match(event("ArrowUp", { altKey: true }))?.action).toBe("wechat.conv.prev");
    expect(match(event("j"), "message-input")).toBeNull();
  });

  it("dispatches Ctrl+N to the feature owned by the current top-level mode", () => {
    topLevelModeStore.set("workbench");
    expect(
      routeKeyboardShortcut({ action: "workspace.new", payload: null }, routingContext),
    ).toEqual({
      kind: "dispatch",
      action: { id: "workspace.new", scope: "sidebar" },
    });

    topLevelModeStore.set("wechat");
    expect(
      routeKeyboardShortcut({ action: "workspace.new", payload: null }, routingContext),
    ).toEqual({
      kind: "dispatch",
      action: { id: "wechat.new-chat", scope: "sidebar" },
    });
  });
});
