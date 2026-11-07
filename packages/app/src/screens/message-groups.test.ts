import { describe, expect, it } from "vitest";
import type { YuyiChatMessage } from "@/yuyi/api";
import { buildMessageGroups } from "./message-groups";

function message(overrides: Partial<YuyiChatMessage> & Pick<YuyiChatMessage, "id" | "at">) {
  return {
    dir: "in" as const,
    text: overrides.id,
    from: { name: "lisi", role: "agent" },
    ...overrides,
  };
}

describe("buildMessageGroups", () => {
  it("groups consecutive messages from the same sender within five minutes", () => {
    const groups = buildMessageGroups([
      message({ id: "a", at: 1_000 }),
      message({ id: "b", at: 120_000 }),
      message({ id: "c", at: 300_000 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.messages.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(groups[0]?.senderName).toBe("lisi");
    expect(groups[0]?.at).toBe(300_000);
  });

  it("starts a new group when the sender changes", () => {
    const groups = buildMessageGroups([
      message({ id: "a", at: 1_000 }),
      message({ id: "b", at: 2_000, from: { name: "other", role: "agent" } }),
    ]);

    expect(groups.map((group) => group.senderName)).toEqual(["lisi", "other"]);
  });

  it("starts a new group when direction changes", () => {
    const groups = buildMessageGroups([
      message({ id: "a", at: 1_000 }),
      message({ id: "b", at: 2_000, dir: "out" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[1]?.mine).toBe(true);
  });

  it("starts a new group after more than five minutes", () => {
    const groups = buildMessageGroups([
      message({ id: "a", at: 1_000 }),
      message({ id: "b", at: 301_001 }),
    ]);

    expect(groups).toHaveLength(2);
  });
});
