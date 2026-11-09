/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageSearchResults } from "./message-search-results";
import { i18n } from "@/i18n/i18next";

describe("MessageSearchResults", () => {
  beforeEach(async () => i18n.changeLanguage("zh-CN"));
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  it("opens the exact host, peer and message when a result is selected", () => {
    const onOpen = vi.fn();
    render(
      <MessageSearchResults
        results={[
          {
            peer: { key: "agent-1:one", title: "One", kind: "agent" },
            message: { id: "message-1", at: 1, dir: "in", text: "命中内容" },
            summary: "命中内容",
            archived: true,
          },
        ]}
        serverId="host-1"
        onOpen={onOpen}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /命中内容/ }));
    expect(onOpen).toHaveBeenCalledWith({
      serverId: "host-1",
      peerKey: "agent-1:one",
      messageId: "message-1",
    });
  });
});
