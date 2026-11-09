import { describe, expect, it } from "vitest";
import { streamChatEvents } from "./chat-events";

function stream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function response(body: ReadableStream<Uint8Array> | null, status = 200): Response {
  return { status, body } as Response;
}

describe("streamChatEvents", () => {
  it("parses multiple events across chunk boundaries with bearer authentication", async () => {
    const encoder = new TextEncoder();
    const events: unknown[] = [];
    let seenAuthorization = "";
    await streamChatEvents({
      origin: "http://localhost",
      bearer: "secret",
      onEvent: (event) => events.push(event),
      fetchImpl: async (_input, init) => {
        seenAuthorization = String(
          init?.headers && (init.headers as Record<string, string>).Authorization,
        );
        const body = stream([
          encoder.encode('event: append\ndata: {"kind":"append","peerKey":"agent:'),
          encoder.encode('one"}\n\nevent: read\ndata: {"kind":"read","peerKey":"agent:two"}\n\n'),
        ]);
        return response(body);
      },
    });

    expect(events).toEqual([
      { kind: "append", peerKey: "agent:one" },
      { kind: "read", peerKey: "agent:two" },
    ]);
    expect(seenAuthorization).toBe("Bearer secret");
  });

  it("rejects a non-200 response so the caller can retain polling and retry", async () => {
    await expect(
      streamChatEvents({
        origin: "http://localhost",
        bearer: null,
        onEvent: () => undefined,
        fetchImpl: async () => response(null, 503),
      }),
    ).rejects.toThrow("503");
  });

  it("passes abort signal to fetch and closes the reader without emitting a final partial event", async () => {
    const controller = new AbortController();
    const events: unknown[] = [];
    let seenSignal: AbortSignal | undefined;
    await streamChatEvents({
      origin: "http://localhost",
      bearer: null,
      signal: controller.signal,
      onEvent: (event) => events.push(event),
      fetchImpl: async (_input, init) => {
        seenSignal = init?.signal ?? undefined;
        controller.abort();
        return response(stream([new TextEncoder().encode('data: {"kind":"read"}\n')]));
      },
    });

    expect(seenSignal).toBe(controller.signal);
    expect(events).toEqual([]);
  });
});
