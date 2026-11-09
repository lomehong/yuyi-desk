import type { YuyiChatEntry, YuyiPeersEntry, YuyiStatus } from "@/yuyi/api";

export interface AgentConversationRow {
  agentId: string;
  title: string;
  kind: "owner" | "agent";
  subtitle: string;
  unread: number;
  lastAt: number;
  sessions: YuyiChatEntry[];
}

export interface DirectoryEntry {
  id: string;
  key: string | null;
  title: string;
  subtitle: string;
  kind: "owner" | "agent";
  role?: string;
  device?: string;
  activity?: YuyiPeersEntry["activity"];
  isLocal: boolean;
  continued: boolean;
  disabled: boolean;
}

export interface DirectoryGroup {
  id: "remote" | "local" | "offline";
  entries: DirectoryEntry[];
}

export function agentIdFromPeerKey(peerKey: string): string {
  const parts = peerKey.split(":");
  return peerKey.startsWith("owner:") ? parts.slice(0, 2).join(":") : (parts[0] ?? peerKey);
}

export function canonicalPeerKey(agentId?: string, sessionName?: string): string | null {
  const id = agentId?.trim();
  const name = sessionName?.trim();
  return id && name ? `${id}:${name}` : null;
}

export function formatUnreadCount(unread: number): string {
  return unread > 99 ? "99+" : String(unread);
}

export function groupAgentRows(conversations: YuyiChatEntry[]): AgentConversationRow[] {
  const groups = new Map<string, YuyiChatEntry[]>();
  for (const conversation of conversations) {
    if (conversation.peer.kind !== "agent" && conversation.peer.kind !== "owner") continue;
    const agentId = agentIdFromPeerKey(conversation.peer.key);
    const key = `${conversation.peer.kind}:${agentId}`;
    const sessions = groups.get(key) ?? [];
    sessions.push(conversation);
    groups.set(key, sessions);
  }
  return [...groups.values()]
    .map((sessions): AgentConversationRow => {
      sessions.sort((left, right) => right.lastAt - left.lastAt);
      const representative = sessions[0]!;
      return {
        agentId: agentIdFromPeerKey(representative.peer.key),
        title: representative.peer.title,
        kind: representative.peer.kind === "owner" ? "owner" : "agent",
        subtitle: representative.lastText,
        unread: sessions.reduce((total, session) => total + session.unread, 0),
        lastAt: representative.lastAt,
        sessions,
      };
    })
    .sort((left, right) => right.lastAt - left.lastAt);
}

function directoryEntry(
  key: string | null,
  title: string,
  subtitle: string,
  options: Partial<DirectoryEntry> = {},
): DirectoryEntry {
  return {
    id: options.id ?? key ?? `disabled:${title}:${subtitle}`,
    key,
    title,
    subtitle,
    kind: options.kind ?? "agent",
    role: options.role,
    device: options.device,
    activity: options.activity,
    isLocal: options.isLocal ?? false,
    continued: options.continued ?? false,
    disabled: options.disabled ?? key === null,
  };
}

/** 把在线 peer 的每个会话归入 local/remote 分组（去重依赖 push 闭包内的 seen） */
function appendPeerSessionEntries(
  peers: YuyiPeersEntry[],
  push: (target: DirectoryEntry[], entry: DirectoryEntry) => void,
  local: DirectoryEntry[],
  remote: DirectoryEntry[],
  localAgentIds: Set<string>,
  conversationKeys: Set<string>,
): void {
  for (const peer of peers) {
    for (const session of peer.sessions) {
      const key = canonicalPeerKey(peer.agentId, session.name);
      const title = session.name ? (session.title ?? session.name) : "（未命名会话）";
      const entry = directoryEntry(key, title, peer.device, {
        id: key ?? `unnamed:${peer.device}:${peer.agentId ?? "unknown"}:${session.sessionID}`,
        role: peer.role,
        device: peer.device,
        activity: peer.activity,
        isLocal: peer.agentId ? localAgentIds.has(peer.agentId) : false,
        continued: key ? conversationKeys.has(key) : false,
        disabled: key === null,
      });
      push(entry.isLocal ? local : remote, entry);
    }
  }
}

/** 把仅存在于会话列表的离线 agent 归入 offline 分组 */
function appendOfflineEntries(
  conversations: YuyiChatEntry[],
  push: (target: DirectoryEntry[], entry: DirectoryEntry) => void,
  offline: DirectoryEntry[],
  onlineAgentIds: Set<string>,
  localAgentIds: Set<string>,
): void {
  for (const conversation of conversations) {
    if (conversation.peer.kind !== "agent" && conversation.peer.kind !== "owner") continue;
    const agentId = agentIdFromPeerKey(conversation.peer.key);
    if (onlineAgentIds.has(agentId) || localAgentIds.has(agentId)) continue;
    push(
      offline,
      directoryEntry(conversation.peer.key, conversation.peer.title, agentId, {
        kind: conversation.peer.kind,
        role: conversation.peer.role,
        continued: true,
      }),
    );
  }
}

export function buildDirectoryGroups(
  peers: YuyiPeersEntry[] | null | undefined,
  status: YuyiStatus | null | undefined,
  conversations: YuyiChatEntry[],
): DirectoryGroup[] {
  const remote: DirectoryEntry[] = [];
  const local: DirectoryEntry[] = [];
  const offline: DirectoryEntry[] = [];
  const seen = new Set<string>();
  const localAgentIds = new Set(
    (status?.bindings ?? [])
      .map((binding) => binding.agentId)
      .filter((agentId): agentId is string => Boolean(agentId)),
  );
  const onlineAgentIds = new Set(
    (peers ?? [])
      .map((peer) => peer.agentId)
      .filter((agentId): agentId is string => Boolean(agentId)),
  );
  const conversationKeys = new Set(conversations.map((conversation) => conversation.peer.key));
  const push = (target: DirectoryEntry[], entry: DirectoryEntry) => {
    if (entry.key && seen.has(entry.key)) return;
    if (entry.key) seen.add(entry.key);
    target.push(entry);
  };

  for (const binding of status?.bindings ?? []) {
    const key = canonicalPeerKey(binding.agentId, binding.name);
    if (!key || !binding.agentId) continue;
    push(
      local,
      directoryEntry(key, binding.title ?? binding.name, binding.name, {
        isLocal: true,
        continued: conversationKeys.has(key),
      }),
    );
  }

  appendPeerSessionEntries(peers ?? [], push, local, remote, localAgentIds, conversationKeys);
  appendOfflineEntries(conversations, push, offline, onlineAgentIds, localAgentIds);

  offline.sort((left, right) => {
    const leftAt =
      conversations.find((conversation) => conversation.peer.key === left.key)?.lastAt ?? 0;
    const rightAt =
      conversations.find((conversation) => conversation.peer.key === right.key)?.lastAt ?? 0;
    return rightAt - leftAt;
  });
  return [
    { id: "remote", entries: remote },
    { id: "local", entries: local },
    { id: "offline", entries: offline },
  ];
}

export function searchConversationsAndAgents(
  query: string,
  conversations: YuyiChatEntry[],
  peers: YuyiPeersEntry[] | null | undefined,
): { conversations: YuyiChatEntry[]; agents: DirectoryEntry[] } {
  const q = query.trim().toLowerCase();
  if (!q) return { conversations: [], agents: [] };
  const matches = (value: string | undefined) => value?.toLowerCase().includes(q) ?? false;
  const conversationResults = conversations.filter(
    (conversation) =>
      matches(conversation.peer.title) ||
      matches(conversation.peer.key) ||
      matches(conversation.lastText),
  );
  const agents: DirectoryEntry[] = [];
  const seen = new Set<string>();
  for (const peer of peers ?? []) {
    for (const session of peer.sessions) {
      const key = canonicalPeerKey(peer.agentId, session.name);
      if (!key || seen.has(key)) continue;
      if (
        !matches(peer.agentId) &&
        !matches(peer.device) &&
        !matches(session.name) &&
        !matches(session.title)
      ) {
        continue;
      }
      seen.add(key);
      agents.push(
        directoryEntry(key, session.title ?? session.name ?? key, peer.device, {
          role: peer.role,
          device: peer.device,
          activity: peer.activity,
          continued: conversations.some((conversation) => conversation.peer.key === key),
        }),
      );
    }
  }
  return { conversations: conversationResults, agents };
}

export function moveDirectoryCursor(
  groups: DirectoryGroup[],
  currentKey: string | null,
  delta: 1 | -1,
): string | null {
  const keys = groups
    .flatMap((group) => group.entries)
    .filter((entry) => !entry.disabled && entry.key !== null)
    .map((entry) => entry.key!);
  if (keys.length === 0) return null;
  const currentIndex = keys.indexOf(currentKey ?? "");
  if (currentIndex < 0) return delta > 0 ? keys[0]! : keys[keys.length - 1]!;
  return keys[(currentIndex + delta + keys.length) % keys.length]!;
}
