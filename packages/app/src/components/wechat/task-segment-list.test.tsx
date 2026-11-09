/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSegmentList } from "./task-segment-list";
import { i18n } from "@/i18n/i18next";
import type { YuyiChatMessage, YuyiTaskIndex } from "@/yuyi/api";

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
}));
vi.mock("@/components/ui/press-highlight", () => ({
  PressHighlight: ({
    children,
    onPress,
    accessibilityLabel,
    testID,
  }: {
    children: React.ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      { type: "button", onClick: onPress, "aria-label": accessibilityLabel, "data-testid": testID },
      children,
    ),
}));

const task: YuyiTaskIndex = {
  taskId: "task_child",
  rootTaskId: "task_root",
  participants: ["agent-a", "agent-b"],
  messageCount: 1,
  firstAt: 2,
  lastAt: 2,
  segments: [
    { taskId: "task_root", messageCount: 2, firstAt: 1, lastAt: 1 },
    { taskId: "task_child", parentTaskId: "task_root", messageCount: 1, firstAt: 2, lastAt: 2 },
  ],
};
const messages: YuyiChatMessage[] = [
  { id: "m1", hubId: "h1", at: 1, dir: "in", text: "root message", taskId: "task_root" },
  { id: "m2", hubId: "h2", at: 2, dir: "in", text: "child message", taskId: "task_child" },
];

describe("TaskSegmentList", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  it("shows real segments, participants, counts and expandable messages", () => {
    const openTaskSegment = vi.fn();
    render(
      <TaskSegmentList
        visible
        task={task}
        messages={messages}
        onClose={vi.fn()}
        onOpenTaskSegment={openTaskSegment}
      />,
    );
    expect(screen.getByRole("button", { name: /task_child/ })).toBeTruthy();
    expect(screen.getByText("agent-a, agent-b")).toBeTruthy();
    expect(screen.getByText("root message")).toBeTruthy();
    expect(screen.queryByText("child message")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /task_child/ }));
    expect(screen.getByText("child message")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /打开任务 task_root/ }));
    expect(openTaskSegment).toHaveBeenCalledWith("task_root");
  });

  it("renders no fabricated task for an empty permission result", () => {
    const { container } = render(
      <TaskSegmentList
        visible
        task={undefined}
        messages={[]}
        onClose={vi.fn()}
        onOpenTaskSegment={vi.fn()}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("shows a chain error instead of pretending the task is valid", () => {
    render(
      <TaskSegmentList
        visible
        task={task}
        messages={messages}
        error="task segment cycle at task_root"
        onClose={vi.fn()}
        onOpenTaskSegment={vi.fn()}
      />,
    );
    expect(screen.getByText(/task segment cycle/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /task_child/ })).toBeNull();
  });
});
