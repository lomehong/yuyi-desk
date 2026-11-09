/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskConversationView } from "./task-conversation-view";
import { i18n } from "@/i18n/i18next";
import type { YuyiTaskIndex } from "@/yuyi/api";

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
}));
vi.mock("@/components/ui/press-highlight", () => ({
  PressHighlight: ({
    children,
    onPress,
    accessibilityLabel,
    disabled,
    testID,
  }: {
    children: React.ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
    disabled?: boolean;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      {
        type: "button",
        onClick: onPress,
        "aria-label": accessibilityLabel,
        disabled,
        "data-testid": testID,
      },
      children,
    ),
}));
vi.mock("@/components/ui/text-input", () => ({
  EditingTextInput: ({
    initialValue,
    onChangeText,
    placeholder,
    accessibilityLabel,
  }: {
    initialValue?: string;
    onChangeText?: (value: string) => void;
    placeholder?: string;
    accessibilityLabel?: string;
  }) =>
    React.createElement("input", {
      defaultValue: initialValue,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChangeText?.(event.target.value),
      placeholder,
      "aria-label": accessibilityLabel ?? placeholder,
    }),
}));

const task: YuyiTaskIndex = {
  taskId: "task_child",
  rootTaskId: "task_root",
  participants: ["agent-a", "agent-b"],
  messageCount: 1,
  firstAt: 2,
  lastAt: 2,
  segments: [
    { taskId: "task_root", messageCount: 1, firstAt: 1, lastAt: 1 },
    { taskId: "task_child", parentTaskId: "task_root", messageCount: 1, firstAt: 2, lastAt: 2 },
  ],
};

describe("TaskConversationView", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  it("makes wildcard delivery explicit, expands segments and navigates members", async () => {
    const broadcast = vi.fn(async () => ({
      ok: true,
      delivery: "delivered" as const,
      taskId: "task_root",
      detail: "forwarded to 2 instance(s)",
    }));
    const openMember = vi.fn();
    render(
      <TaskConversationView
        rootTaskId="task_root"
        title="协作任务"
        task={task}
        messages={[{ id: "m1", at: 1, dir: "in", text: "root message", taskId: "task_root" }]}
        onBroadcast={broadcast}
        onOpenMember={openMember}
      />,
    );
    expect(screen.getByText("广播面向全部可达 Agent")).toBeTruthy();
    expect(screen.getByRole("button", { name: "发送广播" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByPlaceholderText("任务标题"), { target: { value: "发布任务" } });
    fireEvent.change(screen.getByPlaceholderText("广播正文"), { target: { value: "请处理" } });
    fireEvent.click(screen.getByRole("button", { name: "发送广播" }));
    await screen.findByText("forwarded to 2 instance(s)");
    expect(broadcast).toHaveBeenCalledWith({ title: "发布任务", text: "请处理" });

    fireEvent.click(screen.getByRole("button", { name: "查看任务段" }));
    expect(screen.getByRole("button", { name: /task_child/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "成员 agent-a" }));
    expect(openMember).toHaveBeenCalledWith("agent-a");
  });

  it("shows a real failure without inserting a successful task message", async () => {
    render(
      <TaskConversationView
        rootTaskId="task_root"
        title="协作任务"
        task={task}
        messages={[]}
        onBroadcast={vi.fn(async () => ({
          ok: false,
          delivery: "failed" as const,
          taskId: "task_root",
          detail: "denied",
        }))}
        onOpenMember={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("任务标题"), { target: { value: "任务" } });
    fireEvent.change(screen.getByPlaceholderText("广播正文"), { target: { value: "正文" } });
    fireEvent.click(screen.getByRole("button", { name: "发送广播" }));
    await screen.findByText("denied");
    expect(screen.queryByText("正文")).toBeNull();
  });

  it("disables the composer for a closed segment", () => {
    render(
      <TaskConversationView
        rootTaskId="task_root"
        title="已关闭任务"
        task={task}
        messages={[]}
        closed
        onBroadcast={vi.fn()}
        onOpenMember={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "发送广播" })).toHaveProperty("disabled", true);
    expect(screen.getByText("任务段已关闭或归档")).toBeTruthy();
  });
});
