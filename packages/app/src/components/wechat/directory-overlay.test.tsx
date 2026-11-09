/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryOverlay } from "./directory-overlay";
import { buildDirectoryGroups } from "./wechat-model";
import { i18n } from "@/i18n/i18next";

vi.mock("lucide-react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react-native")>();
  return {
    ...actual,
    Bot: () => React.createElement("span"),
    Eye: () => React.createElement("span"),
    Users: () => React.createElement("span"),
    CircleOff: () => React.createElement("span"),
    Search: () => React.createElement("span"),
    X: () => React.createElement("span"),
  };
});

describe("DirectoryOverlay", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  it("skips unnamed sessions during keyboard selection and closes with Escape", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const groups = buildDirectoryGroups(
      [
        {
          device: "dev",
          agentId: "agent-1",
          sessions: [{ sessionID: "raw-unnamed" }, { sessionID: "raw-named", name: "workspace" }],
        },
      ],
      null,
      [],
    );
    render(
      <DirectoryOverlay
        visible
        groups={groups}
        filter=""
        onFilterChange={vi.fn()}
        onPick={onPick}
        onClose={onClose}
      />,
    );
    const input = screen.getByRole("textbox");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: "agent-1:workspace" }));

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses the adaptive dialog and distinguishes online entries from offline history", () => {
    const groups = buildDirectoryGroups(
      [
        {
          device: "dev",
          agentId: "agent-1",
          sessions: [{ sessionID: "raw-named", name: "workspace" }],
        },
      ],
      null,
      [
        {
          peer: { key: "agent-2:old", title: "Offline Agent", kind: "agent" },
          lastAt: 1,
          lastText: "offline",
          unread: 0,
        },
      ],
    );
    render(
      <DirectoryOverlay
        visible
        groups={groups}
        filter=""
        onFilterChange={vi.fn()}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getAllByLabelText("在线")).toHaveLength(1);
  });

  it("does not select an unnamed session with a pointer", () => {
    const onPick = vi.fn();
    const groups = buildDirectoryGroups(
      [{ device: "dev", agentId: "agent-1", sessions: [{ sessionID: "raw-unnamed" }] }],
      null,
      [],
    );
    render(
      <DirectoryOverlay
        visible
        groups={groups}
        filter=""
        onFilterChange={vi.fn()}
        onPick={onPick}
        onClose={vi.fn()}
      />,
    );

    const unnamed = screen.getByRole("button", { name: "（未命名会话）" });
    expect(unnamed.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(unnamed);
    expect(onPick).not.toHaveBeenCalled();
  });
});
