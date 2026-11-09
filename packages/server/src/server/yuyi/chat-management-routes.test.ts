import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerChatManagementRoutes } from "./chat-management-routes.js";

let server: Server | undefined;
let origin = "";
let service: ReturnType<typeof createService>;

function createService() {
  return {
    mcpActive: true,
    chatSearch: vi.fn(async () => ({ results: [] })),
    chatHistory: vi.fn(async () => ({ peerKey: "agent-1:one", messages: [] })),
    chatHistoryAround: vi.fn(async () => null),
    setChatArchived: vi.fn(async () => true),
    setChatPinned: vi.fn(async () => true),
    deleteChat: vi.fn(async () => false),
    taskSnapshot: vi.fn(async () => undefined),
    taskMessages: vi.fn(async () => ({ messages: [] })),
    broadcastAsOwner: vi.fn(async () => ({ ok: true })),
    approvalList: vi.fn(() => ({ approvals: [] })),
    resolveApproval: vi.fn(async () => ({ ok: true })),
    subscribeChatEvents: vi.fn(),
  };
}

beforeEach(async () => {
  service = createService();
  const app = express();
  app.use(express.json());
  registerChatManagementRoutes(app, service);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server!.address();
  if (!address || typeof address === "string") throw new Error("missing test port");
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  server = undefined;
});

describe("chat management routes", () => {
  it("validates search input and applies the requested limit", async () => {
    expect((await fetch(`${origin}/api/yuyi/chat/search?q=`)).status).toBe(400);

    const response = await fetch(
      `${origin}/api/yuyi/chat/search?q=%E9%AA%8C%E8%AF%81&includeArchived=true&limit=1`,
    );
    expect(response.status).toBe(200);
    expect(service.chatSearch).toHaveBeenCalledWith("验证", {
      includeArchived: true,
      limit: 1,
      signal: expect.any(AbortSignal),
    });
  });

  it("validates archive and pin payloads", async () => {
    const archived = await fetch(`${origin}/api/yuyi/chat/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ peerKey: "agent-1:one", archived: true }),
    });
    expect(archived.status).toBe(200);
    expect(service.setChatArchived).toHaveBeenCalledWith("agent-1:one", true);

    expect(
      (
        await fetch(`${origin}/api/yuyi/chat/pin`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ peerKey: "agent-1:one", pinned: "yes" }),
        })
      ).status,
    ).toBe(400);
  });

  it("returns 404 when deleting a missing conversation", async () => {
    const response = await fetch(`${origin}/api/yuyi/chat?peer=missing`, { method: "DELETE" });
    expect(response.status).toBe(404);
  });

  it("returns 404 when the around target does not exist", async () => {
    const response = await fetch(`${origin}/api/yuyi/chat/history?peer=agent-1:one&around=missing`);
    expect(response.status).toBe(404);
  });

  it("returns an empty task when the Hub hides an unauthorized result", async () => {
    const response = await fetch(`${origin}/api/yuyi/task?taskId=task_child`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(service.taskSnapshot).toHaveBeenCalledWith("task_child");
  });

  it("validates broadcasts and returns task messages by root", async () => {
    expect(
      (
        await fetch(`${origin}/api/yuyi/chat/broadcast`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "", text: "正文", taskId: "task_root" }),
        })
      ).status,
    ).toBe(400);
    const broadcast = await fetch(`${origin}/api/yuyi/chat/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "任务", text: "正文", taskId: "task_root" }),
    });
    expect(broadcast.status).toBe(200);
    expect(service.broadcastAsOwner).toHaveBeenCalledWith({
      title: "任务",
      text: "正文",
      taskId: "task_root",
    });

    const messages = await fetch(`${origin}/api/yuyi/task/messages?root=task_root`);
    expect(messages.status).toBe(200);
    expect(service.taskMessages).toHaveBeenCalledWith("task_root");
  });

  it("lists approvals and validates resolutions", async () => {
    expect((await fetch(`${origin}/api/yuyi/approvals`)).status).toBe(200);
    expect(
      (
        await fetch(`${origin}/api/yuyi/approval/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approvalId: "approval-1", decision: "maybe" }),
        })
      ).status,
    ).toBe(400);
    const response = await fetch(`${origin}/api/yuyi/approval/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId: "approval-1", decision: "approved", note: "允许" }),
    });
    expect(response.status).toBe(200);
    expect(service.resolveApproval).toHaveBeenCalledWith({
      approvalId: "approval-1",
      decision: "approved",
      note: "允许",
    });
  });

  it("writes conversation changes to the SSE stream", async () => {
    let emit: ((event: { kind: string; peerKey: string }) => void) | undefined;
    service.subscribeChatEvents.mockImplementation((listener) => {
      emit = listener;
      return () => undefined;
    });
    const response = await fetch(`${origin}/api/yuyi/chat/events`);
    expect(response.status).toBe(200);
    emit?.({ kind: "conversation-changed", peerKey: "agent-1:one" });

    const reader = response.body!.getReader();
    try {
      let text = "";
      while (!text.includes("conversation-changed")) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += new TextDecoder().decode(chunk.value);
      }
      expect(text).toContain('data: {"kind":"conversation-changed","peerKey":"agent-1:one"}');
    } finally {
      await reader.cancel();
    }
  });
});
