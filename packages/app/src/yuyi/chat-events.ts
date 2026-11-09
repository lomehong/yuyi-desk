import type { YuyiApproval, YuyiChatMessage, YuyiTurnProjection } from "@/yuyi/api";

export interface YuyiChatEvent {
  kind:
    | "append"
    | "read"
    | "ack-update"
    | "peers-changed"
    | "turn-changed"
    | "conversation-changed"
    | "approval-changed";
  peerKey: string;
  message?: YuyiChatMessage;
  turn?: YuyiTurnProjection;
  approval?: YuyiApproval;
}

export async function streamChatEvents({
  origin,
  bearer,
  onEvent,
  signal,
  fetchImpl = fetch,
}: {
  origin: string;
  bearer: string | null;
  onEvent: (event: YuyiChatEvent) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const response = await fetchImpl(new URL("/api/yuyi/chat/events", origin), {
    headers: {
      Accept: "text/event-stream",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    signal,
  });
  if (response.status !== 200) throw new Error(`chat events HTTP ${response.status}`);
  if (!response.body) throw new Error("chat events response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consume = (chunk: string) => {
    buffer = (buffer + chunk).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) {
        const parsed = JSON.parse(data) as Partial<YuyiChatEvent>;
        if (
          (parsed.kind === "append" ||
            parsed.kind === "read" ||
            parsed.kind === "ack-update" ||
            parsed.kind === "peers-changed" ||
            parsed.kind === "turn-changed" ||
            parsed.kind === "conversation-changed" ||
            parsed.kind === "approval-changed") &&
          typeof parsed.peerKey === "string"
        ) {
          onEvent(parsed as YuyiChatEvent);
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  };
  try {
    // 读取循环：signal 是外部传入的只读参数，中止/流结束由 body 内 break 承担
    for (;;) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      if (value) consume(decoder.decode(value, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
