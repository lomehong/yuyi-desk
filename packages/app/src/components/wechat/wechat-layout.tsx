/**
 * 「Agent 微信」模式 UI（设计 2026-11 重构）：
 * - WeChatSidebar：侧栏形态（搜索 / ＋发起新会话 / 我的会话 / Agent 会话旁观折叠），
 *   由 LeftSidebar 在 mode=wechat 时整体替换工作区列表；
 * - WeChatMain：主区（选中会话 or 品牌欢迎页），路由 /h/:serverId/wechat 渲染；
 * - selectedPeer 在 wechat-mode-store（左栏 ↔ 主区共享，切模式保留）；
 * - 目录只在「发起新会话」时弹出（决策点②）。
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Bot as BotIcon,
  Eye as EyeIcon,
  MessageSquarePlus as PlusIcon,
  Search as SearchIcon,
  Users as UsersIcon,
} from "lucide-react-native";

import { PressHighlight } from "@/components/ui/press-highlight";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { EditingTextInput } from "@/components/ui/text-input";
import { AgentChatScreen } from "@/screens/agent-chat-screen";
import { useHosts } from "@/runtime/host-runtime";
import { createYuyiClient, type YuyiChatEntry, type YuyiPeersEntry } from "@/yuyi/api";
import { useWeChatSelectedPeer, topLevelModeStore } from "@/stores/wechat-mode-store";
import type { Theme } from "@/styles/theme";

const ThemedBot = withUnistyles(BotIcon);
const ThemedEye = withUnistyles(EyeIcon);
const ThemedUsers = withUnistyles(UsersIcon);
const ThemedSearch = withUnistyles(SearchIcon);
const ThemedPlus = withUnistyles(PlusIcon);

const MUTED_ICON = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });
const AMBER_ICON = (theme: Theme) => ({ color: theme.colors.palette.amber[500] });
const ACCENT_FG_ICON = (theme: Theme) => ({ color: theme.colors.accentForeground });

interface ChatRow {
  key: string;
  title: string;
  kind: "owner" | "agent" | "observe";
  subtitle?: string;
  unread: number;
  lastAt: number;
}

interface DirectoryEntry {
  key: string;
  title: string;
  subtitle: string;
}

function relativeTime(at: number): string {
  const diff = Date.now() - at;
  if (diff < 60_000) return "now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  return `${Math.floor(diff / 86400_000)}d`;
}

/** 行首身份图标：owner=琥珀 Users / observe=Eye / agent=Bot（早返回拆三元） */
function RowAvatar({ kind }: { kind: ChatRow["kind"] }): ReactElement {
  if (kind === "owner") return <ThemedUsers size={16} uniProps={AMBER_ICON} />;
  if (kind === "observe") return <ThemedEye size={14} uniProps={MUTED_ICON} />;
  return <ThemedBot size={16} uniProps={MUTED_ICON} />;
}

/** 左栏/主区共享的会话数据 hook（15s 轮询） */
function useWeChatData() {
  const hosts = useHosts();
  const client = useMemo(() => {
    const host = hosts[0];
    return host ? createYuyiClient(host) : null;
  }, [hosts]);

  const [conversations, setConversations] = useState<YuyiChatEntry[]>([]);
  const [peers, setPeers] = useState<YuyiPeersEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client) return;
    const results = await Promise.allSettled([client.chats.fetchChatList(), client.fetchPeers()]);
    if (results[0].status === "fulfilled") setConversations(results[0].value);
    if (results[1].status === "fulfilled") setPeers(results[1].value);
    const failed = results.find((r) => r.status === "rejected");
    setError(failed ? String((failed as PromiseRejectedResult).reason) : null);
  }, [client]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const directoryEntries = useMemo<DirectoryEntry[]>(() => {
    if (!peers) return [];
    const seen = new Set<string>();
    const entries: DirectoryEntry[] = [];
    for (const p of peers) {
      for (const sess of p.sessions) {
        const key = p.agentId && sess.name ? `${p.agentId}:${sess.name}` : sess.sessionID;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ key, title: sess.name ?? sess.sessionID, subtitle: p.device });
      }
    }
    return entries;
  }, [peers]);

  return { conversations, directoryEntries, error, refresh };
}

function useChatRows(conversations: YuyiChatEntry[], search: string) {
  const rows = useMemo<ChatRow[]>(
    () =>
      conversations.map((c) => ({
        key: c.peer.key,
        title: c.peer.title,
        kind: c.peer.kind,
        subtitle: c.lastText,
        unread: c.unread,
        lastAt: c.lastAt,
      })),
    [conversations],
  );
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.title.toLowerCase().includes(q) || (r.subtitle ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);
  const chatRows = useMemo(() => filteredRows.filter((r) => r.kind !== "observe"), [filteredRows]);
  const observeRows = useMemo(
    () => filteredRows.filter((r) => r.kind === "observe"),
    [filteredRows],
  );
  return { chatRows, observeRows };
}

function ChatRowItem({
  row,
  active,
  onPress,
}: {
  row: ChatRow;
  active: boolean;
  onPress: (row: ChatRow) => void;
}): ReactElement {
  const handlePress = useCallback(() => onPress(row), [onPress, row]);
  const rowStyle = useMemo(() => [styles.chatRow, active && styles.chatRowActive], [active]);
  return (
    <PressHighlight
      onPress={handlePress}
      style={rowStyle}
      highlightStyle={styles.chatRowActive}
      accessibilityLabel={row.title}
    >
      <View style={styles.chatRowInner}>
        <RowAvatar kind={row.kind} />
        <View style={styles.chatRowMain}>
          <View style={styles.chatRowTop}>
            <Text style={styles.chatRowTitle} numberOfLines={1}>
              {row.title}
            </Text>
            <Text style={styles.chatRowTime}>{relativeTime(row.lastAt)}</Text>
          </View>
          <View style={styles.chatRowBottom}>
            <Text style={styles.chatRowSub} numberOfLines={1}>
              {row.subtitle ?? ""}
            </Text>
            {row.unread > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{row.unread}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </PressHighlight>
  );
}

/* ---------------- 侧栏形态（LeftSidebar 在 mode=wechat 时渲染） ---------------- */

export function WeChatSidebar(): ReactElement {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [observeExpanded, setObserveExpanded] = useState(false);
  const { conversations, directoryEntries, error } = useWeChatData();
  const selectedPeer = useWeChatSelectedPeer();
  const { chatRows, observeRows } = useChatRows(conversations, search);

  const openNewChatDialog = useCallback(() => {
    setDirectoryOpen(true);
  }, []);
  const closeNewChatDialog = useCallback(() => {
    setDirectoryOpen(false);
  }, []);
  const toggleObserve = useCallback(() => {
    setObserveExpanded((v) => !v);
  }, []);
  const openChat = useCallback((row: ChatRow) => {
    topLevelModeStore.selectPeer({ key: row.key, title: row.title, kind: row.kind });
  }, []);
  const openDirectoryEntry = useCallback((entry: DirectoryEntry) => {
    setDirectoryOpen(false);
    topLevelModeStore.selectPeer({ key: entry.key, title: entry.title, kind: "agent" });
  }, []);

  return (
    <View style={styles.sidebar}>
      <View style={styles.searchRow}>
        <ThemedSearch size={14} uniProps={MUTED_ICON} />
        <EditingTextInput
          style={styles.searchInput}
          initialValue=""
          onChangeText={setSearch}
          placeholder={t("wechat.searchPlaceholder")}
        />
        <ToolbarButton label={t("wechat.newChat")} onPress={openNewChatDialog} round>
          <ThemedPlus size={15} uniProps={ACCENT_FG_ICON} />
        </ToolbarButton>
      </View>

      <ScrollView style={styles.listScroll} contentContainerStyle={styles.listContent}>
        <Text style={styles.groupTitle}>{t("agentChat.recent")}</Text>
        {chatRows.length === 0 ? (
          <Text style={styles.emptyHint}>{t("wechat.emptyConversations")}</Text>
        ) : (
          chatRows.map((r) => (
            <ChatRowItem
              key={r.key}
              row={r}
              active={selectedPeer?.key === r.key}
              onPress={openChat}
            />
          ))
        )}

        {observeRows.length > 0 ? (
          <>
            <PressHighlight
              style={styles.groupHeader}
              onPress={toggleObserve}
              accessibilityRole="button"
            >
              <ThemedEye size={12} uniProps={MUTED_ICON} />
              <Text style={styles.groupTitle}>
                {t("agentChat.observe")}（{observeRows.length}）
              </Text>
              <Text style={styles.expandCaret}>{observeExpanded ? "▾" : "▸"}</Text>
            </PressHighlight>
            {(observeExpanded ? observeRows : []).map((r) => (
              <ChatRowItem
                key={r.key}
                row={r}
                active={selectedPeer?.key === r.key}
                onPress={openChat}
              />
            ))}
          </>
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>

      <DirectoryModal
        visible={directoryOpen}
        entries={directoryEntries}
        onClose={closeNewChatDialog}
        onPick={openDirectoryEntry}
      />
    </View>
  );
}

/* ---------------- 主区（/h/:serverId/wechat 路由渲染） ---------------- */

export function WeChatMain(): ReactElement {
  const { t } = useTranslation();
  const hosts = useHosts();
  const serverId = hosts[0]?.serverId ?? "";
  const selectedPeer = useWeChatSelectedPeer();
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const { directoryEntries } = useWeChatData();

  const openNewChatDialog = useCallback(() => {
    setDirectoryOpen(true);
  }, []);
  const closeNewChatDialog = useCallback(() => {
    setDirectoryOpen(false);
  }, []);
  const openDirectoryEntry = useCallback((entry: DirectoryEntry) => {
    setDirectoryOpen(false);
    topLevelModeStore.selectPeer({ key: entry.key, title: entry.title, kind: "agent" });
  }, []);

  if (!selectedPeer) {
    return (
      <View style={styles.welcome}>
        <Text style={styles.welcomeTitle}>{t("wechat.welcomeTitle")}</Text>
        <Text style={styles.welcomeSubtitle}>{t("wechat.welcomeSubtitle")}</Text>
        <PressHighlight
          style={styles.welcomeCta}
          onPress={openNewChatDialog}
          accessibilityRole="button"
        >
          <View style={styles.welcomeCtaInner}>
            <ThemedUsers size={15} uniProps={AMBER_ICON} />
            <Text style={styles.welcomeCtaText}>{t("wechat.newChat")}</Text>
          </View>
        </PressHighlight>
        <DirectoryModal
          visible={directoryOpen}
          entries={directoryEntries}
          onClose={closeNewChatDialog}
          onPick={openDirectoryEntry}
        />
      </View>
    );
  }

  return (
    <View style={styles.mainFill}>
      <AgentChatScreen
        serverId={serverId}
        peerKey={selectedPeer.key}
        title={selectedPeer.title}
        kind={selectedPeer.kind}
      />
    </View>
  );
}

function DirectoryModal({
  visible,
  entries,
  onClose,
  onPick,
}: {
  visible: boolean;
  entries: DirectoryEntry[];
  onClose: () => void;
  onPick: (entry: DirectoryEntry) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <ThemedUsers size={14} uniProps={MUTED_ICON} />
            <Text style={styles.modalTitle}>{t("agentChat.directory")}</Text>
            <ToolbarButton label={t("common.actions.close")} onPress={onClose}>
              <Text style={styles.modalCloseGlyph}>✕</Text>
            </ToolbarButton>
          </View>
          <ScrollView style={styles.modalScroll}>
            {entries.length === 0 ? (
              <Text style={styles.emptyHint}>{t("agentChat.noDirectory")}</Text>
            ) : (
              entries.map((entry) => <DirectoryRow key={entry.key} entry={entry} onPick={onPick} />)
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DirectoryRow({
  entry,
  onPick,
}: {
  entry: DirectoryEntry;
  onPick: (entry: DirectoryEntry) => void;
}): ReactElement {
  const handlePress = useCallback(() => onPick(entry), [entry, onPick]);
  const rowStyle = useMemo(() => styles.dirRow, []);
  return (
    <PressHighlight
      onPress={handlePress}
      style={rowStyle}
      highlightStyle={styles.dirRowPressed}
      accessibilityLabel={entry.title}
    >
      <View style={styles.dirRowInner}>
        <ThemedBot size={15} uniProps={MUTED_ICON} />
        <View style={styles.dirRowText}>
          <Text style={styles.dirRowTitle} numberOfLines={1}>
            {entry.title}
          </Text>
          <Text style={styles.dirRowSub} numberOfLines={1}>
            {entry.subtitle}
          </Text>
        </View>
      </View>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  sidebar: { flex: 1 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  searchInput: { flex: 1, minHeight: 30, color: theme.colors.foreground, paddingVertical: 4 },
  listScroll: { flex: 1 },
  listContent: { paddingBottom: theme.spacing[6] },
  groupTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontWeight: theme.fontWeight.semibold,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[1],
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    marginHorizontal: theme.spacing[2],
  },
  expandCaret: { color: theme.colors.foregroundMuted, fontSize: 11 },
  emptyHint: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: 12,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  errorText: { color: theme.colors.palette.red[500], fontSize: 11, padding: theme.spacing[2] },
  chatRow: {
    marginHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  chatRowActive: { backgroundColor: theme.colors.surface2 },
  chatRowInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 9,
    paddingHorizontal: theme.spacing[2],
  },
  chatRowMain: { flex: 1, minWidth: 0 },
  chatRowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chatRowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    flex: 1,
    marginRight: 8,
  },
  chatRowTime: { color: theme.colors.foregroundExtraMuted, fontSize: 11 },
  chatRowBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  chatRowSub: { color: theme.colors.foregroundExtraMuted, fontSize: 12, flex: 1, marginRight: 8 },
  badge: {
    backgroundColor: theme.colors.palette.red[500],
    borderRadius: 9,
    minWidth: 17,
    height: 17,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: theme.fontWeight.semibold },
  mainFill: { flex: 1 },
  welcome: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing[3] },
  welcomeTitle: {
    color: theme.colors.foreground,
    fontSize: 24,
    fontWeight: theme.fontWeight.semibold,
  },
  welcomeSubtitle: { color: theme.colors.foregroundMuted, fontSize: 13 },
  welcomeCta: {
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    marginTop: theme.spacing[2],
  },
  welcomeCtaInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  welcomeCtaText: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: theme.fontWeight.medium,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCard: {
    width: 380,
    maxHeight: 480,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    padding: theme.spacing[3],
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: theme.spacing[2],
  },
  modalTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    flex: 1,
  },
  modalCloseGlyph: { color: theme.colors.foregroundMuted, fontSize: 14 },
  modalScroll: { maxHeight: 380 },
  dirRow: {
    borderRadius: theme.borderRadius.md,
  },
  dirRowPressed: { backgroundColor: theme.colors.surface2 },
  dirRowInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 8,
    paddingHorizontal: theme.spacing[2],
  },
  dirRowText: { flex: 1, minWidth: 0 },
  dirRowTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  dirRowSub: { color: theme.colors.foregroundExtraMuted, fontSize: 11 },
}));
