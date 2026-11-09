/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalCard } from "./approval-card";
import { i18n } from "@/i18n/i18next";
import type { YuyiApproval } from "@/yuyi/api";

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
  }: {
    initialValue?: string;
    onChangeText?: (value: string) => void;
    placeholder?: string;
  }) =>
    React.createElement("input", {
      defaultValue: initialValue,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChangeText?.(event.target.value),
      placeholder,
    }),
}));

function approval(overrides: Partial<YuyiApproval> = {}): YuyiApproval {
  return {
    approvalId: "approval-1",
    agentId: "agent-1",
    requestId: "request-1",
    summary: "允许读取工作区",
    expiresAt: Date.now() + 60_000,
    state: "pending",
    ...overrides,
  };
}

describe("ApprovalCard", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  it("shows the summary and sends an optional note with a real decision", async () => {
    const resolve = vi.fn(async () => ({ ok: true }));
    render(
      <ApprovalCard approval={approval({ remote: true })} onResolve={resolve} onClose={vi.fn()} />,
    );
    expect(screen.getByText("允许读取工作区")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("审批备注（可选）"), {
      target: { value: "仅限本次" },
    });
    fireEvent.click(screen.getByRole("button", { name: "批准" }));
    await screen.findByRole("button", { name: "已批准" });
    expect(resolve).toHaveBeenCalledWith("approved", "仅限本次");
  });

  it("disables actions when expired", () => {
    render(
      <ApprovalCard
        approval={approval({ state: "expired" })}
        onResolve={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "已过期" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "批准" })).toBeNull();
  });

  it("marks a local permission approved only when the real result replaces the snapshot", async () => {
    const resolve = vi.fn(async () => ({ ok: true }));
    const close = vi.fn();
    const { rerender } = render(
      <ApprovalCard approval={approval()} onResolve={resolve} onClose={close} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "批准" }));
    await Promise.resolve();
    expect(screen.queryByRole("button", { name: "已批准" })).toBeNull();
    rerender(
      <ApprovalCard
        approval={approval({ state: "approved" })}
        onResolve={resolve}
        onClose={close}
      />,
    );
    expect(screen.getByRole("button", { name: "已批准" })).toBeTruthy();
  });

  it("keeps pending actions visible after a real failure", () => {
    render(
      <ApprovalCard
        approval={approval({ error: "approval API unavailable" })}
        onResolve={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("approval API unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "批准" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "拒绝" })).toHaveProperty("disabled", false);
  });
});
