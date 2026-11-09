/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useApprovals } from "./wechat-approval-store";
import { useTaskConversation } from "./wechat-task-store";

vi.mock("@/runtime/host-runtime", () => ({ useHosts: () => [] }));
vi.mock("@/navigation/host-route-context", () => ({ useHostRouteServerId: () => undefined }));
vi.mock("./wechat-data-store", () => ({ useWeChatData: () => ({ eventRevision: 0 }) }));

describe("wechat snapshot stability", () => {
  it("keeps an empty task snapshot stable across renders", () => {
    const { result, rerender } = renderHook(() => useTaskConversation("task_stable"));
    const first = result.current;
    rerender();
    expect(result.current.messages).toBe(first.messages);
    expect(result.current.rootTaskId).toBe("task_stable");
  });

  it("does not create a new approval snapshot on every store read", () => {
    const { result, rerender } = renderHook(() => useApprovals("host_stable"));
    const first = result.current;
    rerender();
    expect(result.current.approvals).toEqual([]);
    expect(result.current.refresh).toBe(first.refresh);
  });
});
