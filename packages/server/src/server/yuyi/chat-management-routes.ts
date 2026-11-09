import type { Application, Response } from "express";

interface ChatEvent {
  kind: string;
  peerKey: string;
}

export interface ChatManagementService {
  readonly mcpActive: boolean;
  chatSearch(
    query: string,
    options: { includeArchived: boolean; limit: number; signal: AbortSignal },
  ): Promise<unknown>;
  chatHistory(peerKey: string, tail?: number): Promise<unknown>;
  chatHistoryAround(peerKey: string, messageId: string, context: number): Promise<unknown | null>;
  setChatArchived(peerKey: string, archived: boolean): Promise<boolean>;
  setChatPinned(peerKey: string, pinned: boolean): Promise<boolean>;
  deleteChat(peerKey: string): Promise<boolean>;
  taskSnapshot(taskId: string): Promise<unknown>;
  taskMessages(rootTaskId: string): Promise<unknown>;
  broadcastAsOwner(input: {
    text: string;
    title: string;
    taskId: string;
    parentTaskId?: string;
    myName?: string;
  }): Promise<unknown>;
  approvalList(): unknown;
  resolveApproval(input: {
    approvalId: string;
    decision: "approved" | "denied";
    note?: string;
  }): Promise<unknown>;
  subscribeChatEvents(listener: (event: ChatEvent) => void): () => void;
}

function active(service: ChatManagementService, res: Response): boolean {
  if (service.mcpActive) return true;
  res.status(503).json({ error: "yuyi link inactive" });
  return false;
}

function asyncError(res: Response, error: unknown): void {
  res.status(502).json({ error: String(error) });
}

export function registerChatManagementRoutes(
  app: Application,
  service: ChatManagementService,
): void {
  // 同步 handler + void promise.then().catch()（先例：bootstrap.ts 的 chat/send 等路由）
  app.get("/api/yuyi/chat/search", (req, res) => {
    if (!active(service, res)) return;
    const query = String(req.query.q ?? "").trim();
    if (!query) {
      res.status(400).json({ error: "q 必填" });
      return;
    }
    const parsedLimit = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(100, Math.max(1, Math.floor(parsedLimit)))
      : 50;
    const abort = new AbortController();
    req.on("close", () => abort.abort());
    void service
      .chatSearch(query, {
        includeArchived: req.query.includeArchived === "true",
        limit,
        signal: abort.signal,
      })
      .then((result) => res.json(result))
      .catch((error) => asyncError(res, error));
  });

  app.post("/api/yuyi/chat/archive", (req, res) => {
    if (!active(service, res)) return;
    const body = req.body as { peerKey?: unknown; archived?: unknown };
    if (typeof body.peerKey !== "string" || !body.peerKey || typeof body.archived !== "boolean") {
      res.status(400).json({ error: "peerKey 与 archived 必填" });
      return;
    }
    void service
      .setChatArchived(body.peerKey, body.archived)
      .then((changed) => {
        if (!changed) {
          res.status(404).json({ error: "conversation not found" });
          return undefined;
        }
        res.json({ ok: true });
        return undefined;
      })
      .catch((error) => asyncError(res, error));
  });

  app.post("/api/yuyi/chat/pin", (req, res) => {
    if (!active(service, res)) return;
    const body = req.body as { peerKey?: unknown; pinned?: unknown };
    if (typeof body.peerKey !== "string" || !body.peerKey || typeof body.pinned !== "boolean") {
      res.status(400).json({ error: "peerKey 与 pinned 必填" });
      return;
    }
    void service
      .setChatPinned(body.peerKey, body.pinned)
      .then((changed) => {
        if (!changed) {
          res.status(404).json({ error: "conversation not found" });
          return undefined;
        }
        res.json({ ok: true });
        return undefined;
      })
      .catch((error) => asyncError(res, error));
  });

  app.delete("/api/yuyi/chat", (req, res) => {
    if (!active(service, res)) return;
    const peerKey = String(req.query.peer ?? "").trim();
    if (!peerKey) {
      res.status(400).json({ error: "peer 必填" });
      return;
    }
    void service
      .deleteChat(peerKey)
      .then((deleted) => {
        if (!deleted) {
          res.status(404).json({ error: "conversation not found" });
          return undefined;
        }
        res.json({ ok: true });
        return undefined;
      })
      .catch((error) => asyncError(res, error));
  });

  app.get("/api/yuyi/chat/history", (req, res) => {
    if (!active(service, res)) return;
    const peerKey = String(req.query.peer ?? "").trim();
    if (!peerKey) {
      res.status(400).json({ error: "peer 必填" });
      return;
    }
    const around = String(req.query.around ?? "").trim();
    const tail = Number(req.query.tail ?? 200);
    if (around) {
      void service
        .chatHistoryAround(peerKey, around, 40)
        .then((result) => {
          if (result === null) {
            res.status(404).json({ error: "message not found" });
            return undefined;
          }
          res.json(result);
          return undefined;
        })
        .catch((error) => asyncError(res, error));
      return;
    }
    void service
      .chatHistory(peerKey, Number.isFinite(tail) ? Math.min(Math.max(tail, 1), 1000) : 200)
      .then((result) => res.json(result))
      .catch((error) => asyncError(res, error));
  });

  app.get("/api/yuyi/approvals", (_req, res) => {
    if (!active(service, res)) return;
    res.json(service.approvalList());
  });

  app.post("/api/yuyi/approval/resolve", (req, res) => {
    if (!active(service, res)) return;
    const input = req.body as { approvalId?: unknown; decision?: unknown; note?: unknown };
    if (
      typeof input.approvalId !== "string" ||
      !input.approvalId ||
      (input.decision !== "approved" && input.decision !== "denied")
    ) {
      res.status(400).json({ error: "approvalId 和合法 decision 必填" });
      return;
    }
    void service
      .resolveApproval({
        approvalId: input.approvalId,
        decision: input.decision,
        ...(typeof input.note === "string" ? { note: input.note } : {}),
      })
      .then((result) => res.json(result))
      .catch((error) => asyncError(res, error));
  });

  app.post("/api/yuyi/chat/broadcast", (req, res) => {
    if (!active(service, res)) return;
    const input = req.body as {
      title?: unknown;
      text?: unknown;
      taskId?: unknown;
      parentTaskId?: unknown;
      myName?: unknown;
    };
    if (
      typeof input.title !== "string" ||
      !input.title.trim() ||
      typeof input.text !== "string" ||
      !input.text.trim() ||
      typeof input.taskId !== "string" ||
      !input.taskId.trim()
    ) {
      res.status(400).json({ error: "任务标题、正文和 taskId 必填" });
      return;
    }
    void service
      .broadcastAsOwner({
        title: input.title,
        text: input.text,
        taskId: input.taskId,
        ...(typeof input.parentTaskId === "string" ? { parentTaskId: input.parentTaskId } : {}),
        ...(typeof input.myName === "string" ? { myName: input.myName } : {}),
      })
      .then((result) => res.json(result))
      .catch((error) => asyncError(res, error));
  });

  app.get("/api/yuyi/task/messages", (req, res) => {
    if (!active(service, res)) return;
    const root = String(req.query.root ?? "").trim();
    if (!root) {
      res.status(400).json({ error: "root 必填" });
      return;
    }
    void service
      .taskMessages(root)
      .then((messages) => res.json({ rootTaskId: root, messages }))
      .catch((error) => asyncError(res, error));
  });

  app.get("/api/yuyi/task", (req, res) => {
    if (!active(service, res)) return;
    const taskId = String(req.query.taskId ?? "").trim();
    if (!taskId) {
      res.status(400).json({ error: "taskId 必填" });
      return;
    }
    void service
      .taskSnapshot(taskId)
      .then((snapshot) => res.json(snapshot ?? {}))
      .catch((error) => asyncError(res, error));
  });

  app.get("/api/yuyi/chat/events", (req, res) => {
    if (!active(service, res)) return;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 5000\n\n");
    const unsubscribe = service.subscribeChatEvents((event) => {
      res.write(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 30_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
