/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { draftStore } from "@/stores/wechat-draft-store";
import { clearDraftForPeer, quoteReplyDraft } from "./composer-actions";

describe("composer local actions", () => {
  it("inserts an honest text quote before the current draft and truncates to eighty characters", () => {
    expect(quoteReplyDraft("existing", "reply")).toBe("> reply\n\nexisting");
    expect(quoteReplyDraft("", "x".repeat(90))).toBe(`> ${"x".repeat(80)}…`);
  });

  it("clears only the selected peer draft", () => {
    draftStore.set("agent:one", "first");
    draftStore.set("agent:two", "second");

    clearDraftForPeer("agent:one");

    expect(draftStore.get("agent:one")).toBe("");
    expect(draftStore.get("agent:two")).toBe("second");
  });
});
