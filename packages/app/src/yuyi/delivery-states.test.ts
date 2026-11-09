import { describe, expect, it } from "vitest";
import * as deliveryStates from "./delivery-states";
import type { YuyiChatMessage } from "./api";

function outgoing(overrides: Partial<YuyiChatMessage> = {}): YuyiChatMessage {
  return {
    id: "local-1",
    at: 1_000,
    dir: "out",
    text: "run the tests",
    ...overrides,
  };
}

describe("messageDeliveryState", () => {
  it("prefers the structured delivery kind over ambiguous detail text", () => {
    const msg = outgoing({
      ack: { ok: true, detail: "mail fallback", delivery: "injected" },
    });

    expect(deliveryStates.messageDeliveryState(msg, 2_000)).toBe("injected");
  });

  it("fails an optimistic message after eight seconds without an ack", () => {
    expect(deliveryStates.messageDeliveryState(outgoing(), 9_001)).toBe("failed");
  });

  it("keeps an optimistic message pending before the timeout", () => {
    expect(deliveryStates.messageDeliveryState(outgoing(), 9_000)).toBe("pending");
  });

  it("degrades an injected message to no-reply after ninety seconds without busy evidence", () => {
    const msg = outgoing({ ack: { ok: true, delivery: "injected" } });

    expect(deliveryStates.messageDeliveryState(msg, 91_001, { peerBusy: null })).toBe("noReply");
  });

  it("keeps processing beyond ninety seconds while the peer is genuinely busy", () => {
    const msg = outgoing({ ack: { ok: true, delivery: "injected" } });

    expect(deliveryStates.messageDeliveryState(msg, 91_001, { peerBusy: true })).toBe("injected");
  });

  it("degrades after twenty seconds when the peer is known not to be busy", () => {
    const msg = outgoing({ ack: { ok: true, delivery: "injected" } });

    expect(deliveryStates.messageDeliveryState(msg, 21_001, { peerBusy: false })).toBe("noReply");
  });

  it("settles an injected message as delivered when its peer replies", () => {
    const msg = outgoing({ ack: { ok: true, detail: "已注入" } });

    expect(deliveryStates.messageDeliveryState(msg, 5_000, { hasReply: true })).toBe("delivered");
  });

  it("uses started as a strong processing signal beyond the legacy timeout", () => {
    const msg = outgoing({ ack: { ok: true, delivery: "injected" } });
    expect(
      deliveryStates.messageDeliveryState(msg, 120_000, {
        peerBusy: false,
        turnOutcome: "started",
      }),
    ).toBe("injected");
  });

  it("maps protocol terminal outcomes without fabricating a reply", () => {
    const msg = outgoing({ ack: { ok: true, delivery: "injected" } });
    expect(deliveryStates.messageDeliveryState(msg, 2_000, { turnOutcome: "replied" })).toBe(
      "delivered",
    );
    expect(
      deliveryStates.messageDeliveryState(msg, 2_000, { turnOutcome: "completed-without-reply" }),
    ).toBe("noReply");
    expect(deliveryStates.messageDeliveryState(msg, 2_000, { turnOutcome: "failed" })).toBe(
      "failed",
    );
    expect(
      deliveryStates.messageDeliveryState(msg, 120_000, { turnOutcome: "waiting-permission" }),
    ).toBe("injected");
  });

  it("prefers a real reply over a completed-without-reply event", () => {
    const msg = outgoing({ ack: { ok: true, delivery: "injected" } });
    expect(
      deliveryStates.messageDeliveryState(msg, 2_000, {
        hasReply: true,
        turnOutcome: "completed-without-reply",
      }),
    ).toBe("delivered");
  });
});

describe("reconcilePendingMessages", () => {
  it("removes optimistic entries matched by message id and keeps unmatched entries", () => {
    const reconcile = (
      deliveryStates as unknown as {
        reconcilePendingMessages?: (
          pending: Array<{ tempId: string; messageId?: string; text: string; sentAt: number }>,
          messages: YuyiChatMessage[],
        ) => Array<{ tempId: string }>;
      }
    ).reconcilePendingMessages;
    const pending = [
      { tempId: "pending-1", messageId: "real-1", text: "one", sentAt: 1_000 },
      { tempId: "pending-2", messageId: "real-2", text: "two", sentAt: 2_000 },
    ];

    expect(
      reconcile?.(pending, [outgoing({ id: "real-1", text: "one", at: 1_100 })]).map(
        (item) => item.tempId,
      ),
    ).toEqual(["pending-2"]);
  });

  it("uses text and a ten second timestamp window only when no message id exists", () => {
    const reconcile = (
      deliveryStates as unknown as {
        reconcilePendingMessages?: (
          pending: Array<{ tempId: string; messageId?: string; text: string; sentAt: number }>,
          messages: YuyiChatMessage[],
        ) => Array<{ tempId: string }>;
      }
    ).reconcilePendingMessages;
    const pending = [{ tempId: "pending-1", text: "same", sentAt: 10_000 }];

    expect(reconcile?.(pending, [outgoing({ id: "real-1", text: "same", at: 19_999 })])).toEqual(
      [],
    );
    expect(reconcile?.(pending, [outgoing({ id: "real-2", text: "same", at: 20_001 })])).toEqual(
      pending,
    );
  });
});
