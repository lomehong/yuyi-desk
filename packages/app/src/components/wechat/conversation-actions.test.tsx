/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationActions } from "./conversation-actions";
import { i18n } from "@/i18n/i18next";

const entry = {
  peer: { key: "agent-1:one", title: "One", kind: "agent" as const },
  lastAt: 1,
  lastText: "first",
  unread: 0,
};

// client 需要每次取新的 mock 实例，放到独立工厂函数里构造，避免在 render 同作用域内联对象字面量
function makeClient() {
  return {
    chats: {
      setChatPinned: vi.fn(async () => undefined),
      setChatArchived: vi.fn(async () => undefined),
      deleteChat: vi.fn(async () => undefined),
    },
  };
}

function setup() {
  const client = makeClient();
  const onChanged = vi.fn();
  const onDeleted = vi.fn();
  render(
    <ConversationActions
      entry={entry}
      client={client}
      onChanged={onChanged}
      onDeleted={onDeleted}
    />,
  );
  return { client, onChanged, onDeleted };
}

describe("ConversationActions", () => {
  beforeEach(async () => i18n.changeLanguage("zh-CN"));
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  it("pins and archives through the real client", async () => {
    const { client, onChanged } = setup();
    fireEvent.click(screen.getByRole("button", { name: "会话操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "置顶会话" }));
    await waitFor(() =>
      expect(client.chats.setChatPinned).toHaveBeenCalledWith("agent-1:one", true),
    );

    fireEvent.click(screen.getByRole("button", { name: "会话操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "归档会话" }));
    await waitFor(() =>
      expect(client.chats.setChatArchived).toHaveBeenCalledWith("agent-1:one", true),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("requires confirmation before deleting only the local conversation", async () => {
    const { client, onDeleted } = setup();
    fireEvent.click(screen.getByRole("button", { name: "会话操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除会话" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(client.chats.deleteChat).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "仅删除本机记录" }));
    await waitFor(() => expect(client.chats.deleteChat).toHaveBeenCalledWith("agent-1:one"));
    expect(onDeleted).toHaveBeenCalledWith(entry);
  });

  it("keeps the conversation and shows an error when deletion fails", async () => {
    const { client, onDeleted } = setup();
    client.chats.deleteChat.mockRejectedValue(new Error("disk busy"));
    fireEvent.click(screen.getByRole("button", { name: "会话操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除会话" }));
    fireEvent.click(screen.getByRole("button", { name: "仅删除本机记录" }));

    expect(await screen.findByText("删除失败：disk busy")).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
