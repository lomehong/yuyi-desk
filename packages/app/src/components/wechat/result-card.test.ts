import { describe, expect, it } from "vitest";
import type { YuyiChatMessage } from "@/yuyi/api";
import {
  buildForwardSnapshot,
  collapseResultText,
  groupObservedTurns,
  parseResultBlocks,
  replyExcerpt,
} from "./result-card";

function message(overrides: Partial<YuyiChatMessage> & Pick<YuyiChatMessage, "id" | "at">) {
  return {
    dir: "in" as const,
    text: "result",
    ...overrides,
  };
}

describe("parseResultBlocks", () => {
  it("parses fenced code with its language and indented list lines", () => {
    expect(parseResultBlocks("Summary\n```ts\nconst n = 1;\n```\n- first\n1. second")).toEqual([
      { type: "text", text: "Summary" },
      { type: "code", language: "ts", text: "const n = 1;" },
      { type: "list", text: "- first\n1. second" },
    ]);
  });
});

describe("collapseResultText", () => {
  it("collapses content beyond twenty-eight lines", () => {
    const input = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n");
    const result = collapseResultText(input);

    expect(result.collapsed).toBe(true);
    expect(result.text).toContain("line 28");
    expect(result.text).not.toContain("line 29");
  });

  it("collapses a single very long line to sixteen hundred characters", () => {
    const result = collapseResultText("x".repeat(1700));

    expect(result.collapsed).toBe(true);
    expect(result.text).toHaveLength(1600);
  });
});

describe("replyExcerpt", () => {
  it("resolves replyTo through hub id and truncates the source to forty characters", () => {
    const source = message({ id: "local", hubId: "hub-1", at: 1, text: "x".repeat(50) });

    expect(replyExcerpt([source], "hub-1")).toBe(`${"x".repeat(40)}…`);
    expect(replyExcerpt([source], "missing")).toBeNull();
  });
});

describe("groupObservedTurns", () => {
  it("groups consecutive messages by task id", () => {
    const groups = groupObservedTurns([
      message({ id: "a", at: 1, taskId: "task-1" }),
      message({ id: "b", at: 2, taskId: "task-1" }),
      message({ id: "c", at: 3, taskId: "task-2" }),
    ]);

    expect(groups.map((group) => group.taskId)).toEqual(["task-1", "task-2"]);
    expect(groups[0]?.messages.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("groups unassociated messages only inside a five minute window", () => {
    const groups = groupObservedTurns([
      message({ id: "a", at: 1_000 }),
      message({ id: "b", at: 2_000 }),
      message({ id: "c", at: 400_000 }),
    ]);

    expect(groups.map((group) => group.taskId)).toEqual([null, null]);
    expect(groups[0]?.messages.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("buildForwardSnapshot", () => {
  it("creates an honest text snapshot with an intervention template", () => {
    const output = buildForwardSnapshot("Builder ↔ Hermes", "task-1", [
      message({ id: "a", at: 1_700_000_000_000, from: { name: "Hermes" }, text: "review" }),
    ]);

    expect(output).toContain("【转自旁观】Builder ↔ Hermes · 任务回合 task-1");
    expect(output).toContain("─ Hermes：review");
    expect(output).toContain("（我的介入指令：）");
  });
});
