import type { TurnFinishedFrame, TurnOutcome, TurnStartedFrame } from "@qianji/protocol";

export interface AgentTurnWaitResult {
  permission?: unknown;
  lastMessage?: string | null;
}

export interface RunAgentTurnOptions {
  waitForRunStart: () => Promise<void>;
  waitForFinish: () => Promise<AgentTurnWaitResult>;
  sendStarted: () => Promise<void>;
  sendFinished: (outcome: TurnOutcome) => Promise<void>;
  sendReply: (text: string) => Promise<{ ok: boolean; detail?: string }>;
  onReportError?: (error: unknown) => void;
}

export async function runAgentTurn(opts: RunAgentTurnOptions): Promise<void> {
  const reportFinished = async (outcome: TurnOutcome) => {
    try {
      await opts.sendFinished(outcome);
    } catch (error) {
      opts.onReportError?.(error);
    }
  };

  try {
    await opts.waitForRunStart();
  } catch {
    await reportFinished("failed");
    return;
  }

  try {
    await opts.sendStarted();
  } catch (error) {
    opts.onReportError?.(error);
  }

  let outcome: TurnOutcome;
  try {
    const wait = await opts.waitForFinish();
    if (wait.permission) {
      outcome = "waiting-permission";
    } else {
      const text = wait.lastMessage?.trim() ?? "";
      if (!text) {
        outcome = "completed-without-reply";
      } else {
        const ack = await opts.sendReply(text);
        outcome = ack.ok ? "replied" : "failed";
      }
    }
  } catch {
    outcome = "failed";
  }
  await reportFinished(outcome);
}

export interface TurnProjection {
  replyTo: string;
  agentId: string;
  taskId?: string;
  outcome: "started" | TurnOutcome;
  at: number;
}

export class TurnEventProjection {
  private readonly byReplyTo = new Map<string, TurnProjection>();
  private readonly listeners = new Set<(turn: TurnProjection) => void>();

  constructor(private readonly now: () => number = Date.now) {}

  subscribe(listener: (turn: TurnProjection) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  apply(frame: TurnStartedFrame | TurnFinishedFrame): TurnProjection {
    const turn: TurnProjection = {
      replyTo: frame.replyTo,
      agentId: frame.agentId,
      ...(frame.taskId ? { taskId: frame.taskId } : {}),
      outcome: frame.type === "agent/turn-started" ? "started" : frame.outcome,
      at: this.now(),
    };
    this.byReplyTo.set(frame.replyTo, turn);
    for (const listener of this.listeners) listener(turn);
    return turn;
  }

  get(replyTo: string): TurnProjection | undefined {
    const turn = this.byReplyTo.get(replyTo);
    return turn ? { ...turn } : undefined;
  }
}
