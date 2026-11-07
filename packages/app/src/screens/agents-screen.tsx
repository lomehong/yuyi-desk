/**
 * 「Agent 微信」M1 · Agents 页签（通讯录 + 最近会话，设计 §5）。
 *
 * 主区：最近会话（本地会话库，点击进会话页）+ 在线 Agent 目录（peers；
 *   离线 Agent 从目录消失，仅可从最近会话进入——设计 §3）。
 * 侧区：本机绑定（dogfood 自测回路）。
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { BadgeCheck, Bot, Circle, MessageSquare } from "lucide-react-native";

import { MenuHeader } from "@/components/headers/menu-header";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useHosts } from "@/runtime/host-runtime";
import { createYuyiClient, type YuyiChatEntry, type YuyiPeersEntry } from "@/yuyi/api";
import type { Theme } from "@/styles/theme";

/** 主题色图标（docs/unistyles.md 方案 3）：module scope 包装一次 + 常量映射 */
const ThemedBadgeCheck = withUnistyles(BadgeCheck);
const ThemedBot = withUnistyles(Bot);
const ThemedCircle = withUnistyles(Circle);
const ThemedMessageSquare = withUnistyles(MessageSquare);

const AMBER_ICON = (theme: Theme) => ({ color: theme.colors.palette.amber[500] });
const MUTED_ICON = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });
const GREEN_DOT_ICON = (theme: Theme) => ({
  color: theme.colors.palette.green[500],
  fill: theme.colors.palette.green[500],
});

interface PeerRow {
  key: string;
  title: string;
  kind: "owner" | "agent" | "local";
  role?: string;
  subtitle?: string;
  online?: boolean;
  unread?: number;
  lastText?: string;
  lastAt?: number;
  /** 是否来自最近会话（vs 目录） */
  fromConversations: boolean;
}

function fmtLast(at: number): string {
  const diff = Date.now() - at;
  if (diff < 60_000) return "now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  return `${Math.floor(diff / 86400_000)}d`;
}

export function AgentsScreen(): ReactElement {
  const { t } = useTranslation();
  const router = useRouter();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const hosts = useHosts();
  const host = hosts.find((h) => h.serverId === serverId);
  const client = useMemo(() => (host ? createYuyiClient(host) : null), [host]);

  const [conversations, setConversations] = useState<YuyiChatEntry[]>([]);
  const [peers, setPeers] = useState<YuyiPeersEntry[] | null>(null);
  const [status, setStatus] = useState<{
    device: string;
    bindings: Array<{ name: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client) return;
    const results = await Promise.allSettled([
      client.chats.fetchChatList(),
      client.fetchPeers(),
      client.fetchStatus(),
    ]);
    if (results[0].status === "fulfilled") setConversations(results[0].value);
    if (results[1].status === "fulfilled") setPeers(results[1].value);
    if (results[2].status === "fulfilled") setStatus(results[2].value);
    const failed = results.find((r) => r.status === "rejected");
    setError(failed ? String((failed as PromiseRejectedResult).reason) : null);
  }, [client]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(timer);
  }, [refresh]);

  // 目录行：peers 扁平化为 agent 行（agentId:name 聚合、同 key 去重、已在会话里的跳过）
  const convKeys = useMemo(() => new Set(conversations.map((c) => c.peer.key)), [conversations]);
  const directoryRows = useMemo<PeerRow[]>(() => {
    if (!peers) return [];
    const seen = new Set<string>();
    const rows: PeerRow[] = [];
    for (const p of peers) {
      for (const s of p.sessions) {
        const key = p.agentId && s.name ? `${p.agentId}:${s.name}` : s.sessionID;
        if (seen.has(key) || convKeys.has(key)) continue;
        seen.add(key);
        rows.push({
          key,
          title: s.name ?? s.sessionID,
          kind: p.role === "owner" ? "owner" : "agent",
          role: p.role,
          subtitle: p.device,
          online: true,
          fromConversations: false,
        });
      }
    }
    return rows;
  }, [peers, convKeys]);

  const convRows = useMemo<PeerRow[]>(
    () =>
      conversations.map((c) => ({
        key: c.peer.key,
        title: c.peer.title,
        kind: c.peer.kind,
        role: c.peer.role,
        subtitle: c.lastText,
        unread: c.unread,
        lastAt: c.lastAt,
        fromConversations: true,
      })),
    [conversations],
  );

  const localRows = useMemo<PeerRow[]>(
    () =>
      (status?.bindings ?? []).map((b) => ({
        key: `local:${b.name}`,
        title: b.name,
        kind: "local" as const,
        subtitle: t("agentChat.localDevice"),
        fromConversations: false,
      })),
    [status, t],
  );

  const openChat = useCallback(
    (row: PeerRow) => {
      if (row.kind === "local") return; // 本机绑定：M1 不开本机会话（dogfood 经远端回环）
      router.push({
        pathname: `/h/${serverId}/agents/chat`,
        params: { peerKey: row.key, title: row.title, kind: row.kind },
      } as never);
    },
    [router, serverId],
  );

  return (
    <View style={styles.container}>
      <MenuHeader title={t("agentChat.title")} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <SectionTitle label={t("agentChat.recent")} />
        {convRows.length === 0 ? (
          <Text style={styles.hint}>{t("agentChat.noConversations")}</Text>
        ) : (
          convRows.map((r) => (
            <PeerRowItem key={r.key} row={r} onPress={openChat} showUnread showLast />
          ))
        )}

        <SectionTitle label={t("agentChat.directory")} />
        {directoryRows.length === 0 ? (
          <Text style={styles.hint}>{t("agentChat.noDirectory")}</Text>
        ) : (
          directoryRows.map((r) => <PeerRowItem key={`d-${r.key}`} row={r} onPress={openChat} />)
        )}

        <SectionTitle label={t("agentChat.thisDevice")} />
        {localRows.map((r) => (
          <PeerRowItem key={r.key} row={r} onPress={openChat} muted />
        ))}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </View>
  );
}

function SectionTitle({ label }: { label: string }): ReactElement {
  return <Text style={styles.sectionTitle}>{label}</Text>;
}

/** 行首身份图标：owner=琥珀 BadgeCheck / local=绿点 / agent=Bot（早返回拆三元） */
function RowAvatar({ kind }: { kind: PeerRow["kind"] }): ReactElement {
  if (kind === "owner") return <ThemedBadgeCheck size={16} uniProps={AMBER_ICON} />;
  if (kind === "local") return <ThemedCircle size={10} uniProps={GREEN_DOT_ICON} />;
  return <ThemedBot size={16} uniProps={MUTED_ICON} />;
}

function PeerRowItem({
  row,
  onPress,
  showUnread = false,
  showLast = false,
  muted = false,
}: {
  row: PeerRow;
  onPress: (r: PeerRow) => void;
  showUnread?: boolean;
  showLast?: boolean;
  muted?: boolean;
}): ReactElement {
  const handlePress = useCallback(() => onPress(row), [onPress, row]);
  const rowStyle = useMemo(() => [styles.row, muted && styles.rowMuted], [muted]);
  return (
    <PressHighlight
      onPress={handlePress}
      disabled={muted}
      style={rowStyle}
      highlightStyle={styles.rowPressed}
      accessibilityLabel={row.title}
    >
      <View style={styles.rowLeft}>
        <RowAvatar kind={row.kind} />
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, muted && styles.rowMutedText]} numberOfLines={1}>
            {row.title}
            {row.kind === "owner" ? <Text style={styles.ownerTag}> · Owner</Text> : null}
          </Text>
          {row.subtitle ? (
            <Text style={styles.rowSub} numberOfLines={1}>
              {row.subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.rowRight}>
        {showLast && row.lastAt ? <Text style={styles.rowTime}>{fmtLast(row.lastAt)}</Text> : null}
        {showUnread && (row.unread ?? 0) > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{row.unread}</Text>
          </View>
        ) : null}
        {row.online ? <View style={styles.onlineDot} /> : null}
        <ThemedMessageSquare size={14} uniProps={MUTED_ICON} style={styles.rowChatIcon} />
      </View>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, backgroundColor: theme.colors.surface0 },
  scroll: { flex: 1 },
  content: { padding: theme.spacing[3], paddingBottom: theme.spacing[8] },
  sectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 12,
    marginBottom: 4,
  },
  hint: {
    color: theme.colors.foregroundExtraMuted,
    paddingVertical: theme.spacing[2],
    fontSize: 12,
  },
  error: { color: theme.colors.palette.red[500], padding: theme.spacing[2], fontSize: 12 },
  rowChatIcon: { opacity: 0.4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    gap: theme.spacing[2],
  },
  rowPressed: { backgroundColor: theme.colors.surface1 },
  rowMuted: { opacity: 0.6 },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  rowMutedText: { color: theme.colors.foregroundMuted },
  ownerTag: { color: theme.colors.palette.amber[500], fontSize: 11 },
  rowSub: { color: theme.colors.foregroundExtraMuted, fontSize: 12, marginTop: 1 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTime: { color: theme.colors.foregroundExtraMuted, fontSize: 11 },
  badge: {
    backgroundColor: theme.colors.palette.red[500],
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.palette.green[500],
  },
}));
