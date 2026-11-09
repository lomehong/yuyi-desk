import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useHosts } from "@/runtime/host-runtime";
import { useHostRouteServerId } from "@/navigation/host-route-context";
import {
  createYuyiClient,
  type OwnerBroadcastResult,
  type YuyiChatMessage,
  type YuyiClient,
  type YuyiTaskIndex,
} from "@/yuyi/api";
import { useWeChatData } from "./wechat-data-store";

export interface TaskConversation {
  rootTaskId: string;
  task?: YuyiTaskIndex;
  messages: YuyiChatMessage[];
  loaded: boolean;
  error: string | null;
}

const EMPTY_TASK: TaskConversation = { rootTaskId: "", messages: [], loaded: false, error: null };
const snapshots = new Map<string, TaskConversation>();
const generations = new Map<string, number>();
const listeners = new Set<() => void>();

function keyFor(serverId: string, rootTaskId: string): string {
  return `${serverId}\0${rootTaskId}`;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTaskConversationSnapshot(
  serverId: string,
  rootTaskId: string,
): TaskConversation {
  const key = keyFor(serverId, rootTaskId);
  const existing = snapshots.get(key);
  if (existing) return existing;
  const empty = { ...EMPTY_TASK, rootTaskId };
  snapshots.set(key, empty);
  return empty;
}

export async function refreshTaskConversation(
  client: YuyiClient,
  serverId: string,
  rootTaskId: string,
): Promise<void> {
  const key = keyFor(serverId, rootTaskId);
  const generation = (generations.get(key) ?? 0) + 1;
  generations.set(key, generation);
  try {
    const [messagesResult, taskResult] = await Promise.all([
      client.chats.fetchTaskMessages?.(rootTaskId) ?? Promise.resolve({ rootTaskId, messages: [] }),
      client.chats.fetchTask?.(rootTaskId) ?? Promise.resolve<{ task?: YuyiTaskIndex }>({}),
    ]);
    if (generations.get(key) !== generation) return;
    snapshots.set(key, {
      rootTaskId,
      task: taskResult.task,
      messages: messagesResult.messages,
      loaded: true,
      error: null,
    });
  } catch (error) {
    if (generations.get(key) !== generation) return;
    snapshots.set(key, {
      ...getTaskConversationSnapshot(serverId, rootTaskId),
      loaded: true,
      error: String(error),
    });
  }
  emit();
}

export async function broadcastTask(
  client: YuyiClient,
  serverId: string,
  input: { title: string; text: string; taskId: string; parentTaskId?: string; myName?: string },
): Promise<OwnerBroadcastResult> {
  const result = client.chats.broadcastChat
    ? await client.chats.broadcastChat(input)
    : {
        ok: false,
        delivery: "failed" as const,
        taskId: input.taskId,
        detail: "broadcast API unavailable",
      };
  if (result.ok) await refreshTaskConversation(client, serverId, input.taskId);
  return result;
}

export function useTaskConversation(
  rootTaskId: string,
  serverId?: string,
): TaskConversation & {
  refresh: () => Promise<void>;
  broadcast: (input: {
    title: string;
    text: string;
    parentTaskId?: string;
    myName?: string;
  }) => Promise<OwnerBroadcastResult>;
} {
  const hosts = useHosts();
  const routeServerId = useHostRouteServerId();
  const effectiveServerId = serverId ?? routeServerId;
  const host = effectiveServerId
    ? hosts.find((item) => item.serverId === effectiveServerId)
    : hosts[0];
  const client = useMemo(() => (host ? createYuyiClient(host) : null), [host]);
  const { eventRevision } = useWeChatData(host?.serverId);
  const key = host?.serverId ?? "";
  const snapshot = useSyncExternalStore(subscribe, () =>
    getTaskConversationSnapshot(key, rootTaskId),
  );
  const refresh = useCallback(async () => {
    if (client && rootTaskId) await refreshTaskConversation(client, key, rootTaskId);
  }, [client, key, rootTaskId]);
  useEffect(() => {
    void refresh();
  }, [refresh, eventRevision]);
  const broadcast = useCallback(
    (input: { title: string; text: string; parentTaskId?: string; myName?: string }) => {
      if (!client) {
        return Promise.resolve({
          ok: false,
          delivery: "failed" as const,
          taskId: rootTaskId,
          detail: "no http origin",
        });
      }
      return broadcastTask(client, key, { ...input, taskId: rootTaskId });
    },
    [client, key, rootTaskId],
  );
  return { ...snapshot, refresh, broadcast };
}
