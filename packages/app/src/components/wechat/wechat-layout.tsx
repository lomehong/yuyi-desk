import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  AlertTriangle,
  ChevronDown,
  Eye as EyeIcon,
  MessageSquarePlus as PlusIcon,
  RefreshCw,
  Search as SearchIcon,
} from "lucide-react-native";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { AgentChatScreen } from "@/screens/agent-chat-screen";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useHosts } from "@/runtime/host-runtime";
import type { YuyiChatEntry } from "@/yuyi/api";
import {
  useDirectoryFilter,
  useDirectoryOpen,
  useObserveExpanded,
  useSearchFocusVersion,
  useSidebarSearch,
  useTopLevelMode,
  useWeChatSelectedPeer,
  topLevelModeStore,
  wechatUiStore,
} from "@/stores/wechat-mode-store";
import { useWeChatData } from "@/stores/wechat-data-store";
import { classifyDelivery } from "@/yuyi/delivery-states";
import type { Theme } from "@/styles/theme";
import { DirectoryOverlay } from "./directory-overlay";
import { AgentAvatar } from "./agent-avatar";
import {
  buildDirectoryGroups,
  formatUnreadCount,
  groupAgentRows,
  searchConversationsAndAgents,
  type AgentConversationRow,
  type DirectoryEntry,
} from "./wechat-model";

const ThemedEye = withUnistyles(EyeIcon);
const ThemedSearch = withUnistyles(SearchIcon);
const ThemedPlus = withUnistyles(PlusIcon);
const ThemedChevron = withUnistyles(ChevronDown);
const ThemedWarning = withUnistyles(AlertTriangle);
const ThemedRefresh = withUnistyles(RefreshCw);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });
const amberIcon = (theme: Theme) => ({ color: theme.colors.palette.amber[500] });
const accentForegroundIcon = (theme: Theme) => ({ color: theme.colors.accentForeground });

type Translate = (key: string, options?: Record<string, unknown>) => string;

function relativeTime(at: number, t: Translate): string {
  const diff = Math.max(0, Date.now() - at);
  if (diff < 60_000) return t("wechat.time.now");
  if (diff < 3_600_000) return t("wechat.time.minutes", { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("wechat.time.hours", { count: Math.floor(diff / 3_600_000) });
  if (diff < 172_800_000) return t("wechat.time.yesterday");
  return new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric" }).format(at);
}

function deliveryMark(entry: YuyiChatEntry): string {
  if (entry.lastDir !== "out" || !entry.lastAck) return "";
  switch (classifyDelivery(entry.lastAck)) {
    case "injected":
      return " ···";
    case "mailed":
      return " ✉";
    case "failed":
      return " ✗";
    default:
      return " ✓";
  }
}

function AgentRowItem({
  row,
  activeKey,
  expanded,
  online,
  onOpen,
  onToggle,
}: {
  row: AgentConversationRow;
  activeKey?: string;
  expanded: boolean;
  online: boolean;
  onOpen: (entry: YuyiChatEntry) => void;
  onToggle: (agentId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const representative = row.sessions[0]!;
  const active = row.sessions.some((session) => session.peer.key === activeKey);
  const handleOpen = useCallback(() => onOpen(representative), [onOpen, representative]);
  const handleToggle = useCallback(() => onToggle(row.agentId), [onToggle, row.agentId]);
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  const chevronStyle = useMemo(
    () => ({ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }),
    [expanded],
  );
  return (
    <View style={styles.agentGroup}>
      <PressHighlight
        style={[styles.chatRow, (active || row.unread > 0) && styles.unreadRow]}
        highlightStyle={styles.chatRowHover}
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        accessibilityLabel={row.title}
      >
        {row.unread > 0 ? <View style={styles.unreadStrip} /> : null}
        <AgentAvatar kind={row.kind} />
        <View style={styles.chatRowMain}>
          <View style={styles.chatRowTop}>
            <Text style={styles.chatRowTitle} numberOfLines={1}>
              {row.title}
            </Text>
            <Text style={styles.chatRowTime}>{relativeTime(row.lastAt, t)}</Text>
          </View>
          <View style={styles.chatRowBottom}>
            <Text style={styles.chatRowSub} numberOfLines={1}>
              {representative.lastDir === "out" ? t("wechat.mePrefix") : ""}
              {row.subtitle}
              {deliveryMark(representative)}
            </Text>
            {row.unread > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{formatUnreadCount(row.unread)}</Text>
              </View>
            ) : null}
          </View>
        </View>
        {online ? <View style={styles.onlineDot} /> : null}
        {row.sessions.length > 1 ? (
          <ToolbarButton
            label={expanded ? t("wechat.collapseSessions") : t("wechat.expandSessions")}
            onPress={handleToggle}
          >
            <ThemedChevron size={14} uniProps={mutedIcon} style={chevronStyle} />
          </ToolbarButton>
        ) : null}
      </PressHighlight>
      {expanded
        ? row.sessions
            .slice(1)
            .map((session) => (
              <AgentSessionRow
                key={session.peer.key}
                session={session}
                activeKey={activeKey}
                onOpen={onOpen}
              />
            ))
        : null}
    </View>
  );
}

/** 展开后的单个会话子行：回调与 accessibilityState 都在本组件内稳定化 */
function AgentSessionRow({
  session,
  activeKey,
  onOpen,
}: {
  session: YuyiChatEntry;
  activeKey?: string;
  onOpen: (entry: YuyiChatEntry) => void;
}): ReactElement {
  const handleOpen = useCallback(() => onOpen(session), [onOpen, session]);
  const selected = activeKey === session.peer.key;
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <PressHighlight
      style={styles.sessionRow}
      onPress={handleOpen}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
    >
      <Text style={styles.sessionName} numberOfLines={1}>
        {session.peer.key.split(":").at(-1)}
      </Text>
      {session.unread > 0 ? (
        <Text style={styles.sessionUnread}>{formatUnreadCount(session.unread)}</Text>
      ) : null}
    </PressHighlight>
  );
}

function ObserveRow({
  entry,
  active,
  onPress,
}: {
  entry: YuyiChatEntry;
  active: boolean;
  onPress: (entry: YuyiChatEntry) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onPress(entry), [entry, onPress]);
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  return (
    <PressHighlight
      style={[styles.chatRow, styles.observeRow]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
    >
      <AgentAvatar kind="observe" />
      <View style={styles.chatRowMain}>
        <Text style={styles.chatRowTitle} numberOfLines={1}>
          {entry.peer.title}
        </Text>
        <Text style={styles.chatRowSub} numberOfLines={1}>
          {entry.lastText}
        </Text>
      </View>
      {entry.unread > 0 ? <View style={styles.observeUnreadDot} /> : null}
      <Text style={styles.chatRowTime}>{relativeTime(entry.lastAt, t)}</Text>
    </PressHighlight>
  );
}

/** 旁观区分组头：展开/收起、计数与未读点；回调与 accessibilityState 在组件内稳定化 */
function ObserveGroupHeader({
  expanded,
  count,
  unread,
  onToggleExpanded,
}: {
  expanded: boolean;
  count: number;
  unread: number;
  onToggleExpanded: (next: boolean) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handleToggle = useCallback(() => onToggleExpanded(!expanded), [expanded, onToggleExpanded]);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const chevronStyle = useMemo(
    () => ({ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }),
    [expanded],
  );
  return (
    <PressHighlight
      style={styles.groupHeader}
      onPress={handleToggle}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
    >
      <ThemedEye size={12} uniProps={mutedIcon} />
      <Text style={styles.groupTitle}>
        {t("agentChat.observe")}（{count}）
      </Text>
      {unread > 0 ? <View style={styles.observeUnreadDot} /> : null}
      <ThemedChevron size={13} uniProps={mutedIcon} style={chevronStyle} />
    </PressHighlight>
  );
}

function SearchResultRow({
  entry,
  onOpen,
}: {
  entry: YuyiChatEntry;
  onOpen: (entry: YuyiChatEntry) => void;
}) {
  const handlePress = useCallback(() => onOpen(entry), [entry, onOpen]);
  return (
    <PressHighlight style={styles.searchResult} onPress={handlePress} accessibilityRole="button">
      <AgentAvatar kind={entry.peer.kind} size={28} />
      <View style={styles.chatRowMain}>
        <Text style={styles.chatRowTitle} numberOfLines={1}>
          {entry.peer.title}
        </Text>
        <Text style={styles.chatRowSub} numberOfLines={1}>
          {entry.lastText}
        </Text>
      </View>
    </PressHighlight>
  );
}

function AgentSearchResultRow({
  entry,
  onOpen,
}: {
  entry: DirectoryEntry;
  onOpen: (entry: DirectoryEntry) => void;
}) {
  const handlePress = useCallback(() => onOpen(entry), [entry, onOpen]);
  return (
    <PressHighlight style={styles.searchResult} onPress={handlePress} accessibilityRole="button">
      <AgentAvatar kind={entry.kind} size={28} />
      <View style={styles.chatRowMain}>
        <Text style={styles.chatRowTitle} numberOfLines={1}>
          {entry.title}
        </Text>
        <Text style={styles.chatRowSub} numberOfLines={1}>
          {entry.subtitle}
        </Text>
      </View>
    </PressHighlight>
  );
}

export function WeChatSidebar(): ReactElement {
  const { t } = useTranslation();
  const search = useSidebarSearch();
  const observeExpanded = useObserveExpanded();
  const searchFocusVersion = useSearchFocusVersion();
  const searchRef = useRef<EditingTextInputHandle>(null);
  const { conversations, peers, error, refresh } = useWeChatData();
  const selectedPeer = useWeChatSelectedPeer();
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const agentRows = useMemo(() => groupAgentRows(conversations), [conversations]);
  const observeRows = useMemo(
    () => conversations.filter((entry) => entry.peer.kind === "observe"),
    [conversations],
  );
  const searchResults = useMemo(
    () => searchConversationsAndAgents(search, conversations, peers),
    [conversations, peers, search],
  );
  const hasSearch = search.trim().length > 0;
  const observeUnread = observeRows.reduce((total, entry) => total + entry.unread, 0);

  useEffect(() => {
    if (observeUnread > 0) wechatUiStore.expandObserveForUnread();
  }, [observeUnread]);
  useEffect(() => {
    if (searchFocusVersion > 0) searchRef.current?.focus();
  }, [searchFocusVersion]);
  useEffect(() => {
    if (!search) searchRef.current?.reset();
  }, [search]);

  const openChat = useCallback((entry: YuyiChatEntry) => {
    topLevelModeStore.selectPeer({ ...entry.peer });
    wechatUiStore.setSearch("");
  }, []);
  const openAgent = useCallback((entry: DirectoryEntry) => {
    if (!entry.key || entry.disabled) return;
    topLevelModeStore.selectPeer({ key: entry.key, title: entry.title, kind: entry.kind });
    wechatUiStore.setSearch("");
  }, []);
  const toggleAgent = useCallback((agentId: string) => {
    setExpandedAgents((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);
  const onSearchKey = useCallback(
    (event: { nativeEvent?: { key?: string } }) => {
      if (event.nativeEvent?.key !== "Escape") return;
      if (search) wechatUiStore.setSearch("");
      else searchRef.current?.blur();
    },
    [search],
  );

  return (
    <View style={styles.sidebar}>
      <View style={styles.searchRow}>
        <View style={styles.searchPill}>
          <ThemedSearch size={14} uniProps={mutedIcon} />
          <EditingTextInput
            ref={searchRef}
            style={styles.searchInput}
            initialValue={search}
            onChangeText={wechatUiStore.setSearch}
            onKeyPress={onSearchKey}
            placeholder={t("wechat.searchPlaceholder")}
          />
        </View>
        <View style={styles.newChatButton}>
          <ToolbarButton
            label={t("wechat.contactAgent")}
            onPress={wechatUiStore.openDirectory}
            round
          >
            <ThemedPlus size={15} uniProps={accentForegroundIcon} />
          </ToolbarButton>
        </View>
      </View>
      <ScrollView style={styles.listScroll} contentContainerStyle={styles.listContent}>
        {hasSearch ? (
          <View style={styles.searchResults}>
            <Text style={styles.groupTitle}>
              {t("wechat.conversationResults", { count: searchResults.conversations.length })}
            </Text>
            {searchResults.conversations.map((entry) => (
              <SearchResultRow key={entry.peer.key} entry={entry} onOpen={openChat} />
            ))}
            <Text style={styles.groupTitle}>
              {t("wechat.agentResults", { count: searchResults.agents.length })}
            </Text>
            {searchResults.agents.map((entry) => (
              <AgentSearchResultRow key={entry.id} entry={entry} onOpen={openAgent} />
            ))}
            {searchResults.conversations.length + searchResults.agents.length === 0 ? (
              <PressHighlight
                style={styles.searchEmpty}
                onPress={wechatUiStore.openDirectory}
                accessibilityRole="button"
              >
                <Text style={styles.emptyHint}>{t("wechat.noSearchResults")}</Text>
              </PressHighlight>
            ) : null}
          </View>
        ) : (
          <>
            <Text style={styles.groupTitle}>{t("agentChat.recent")}</Text>
            {agentRows.length === 0 ? (
              <Text style={styles.emptyHint}>{t("wechat.emptyConversations")}</Text>
            ) : null}
            {agentRows.map((row) => (
              <AgentRowItem
                key={`${row.kind}:${row.agentId}`}
                row={row}
                activeKey={selectedPeer?.key}
                expanded={expandedAgents.has(row.agentId)}
                online={Boolean(peers?.some((peer) => peer.agentId === row.agentId))}
                onOpen={openChat}
                onToggle={toggleAgent}
              />
            ))}
            {observeRows.length > 0 ? (
              <>
                <ObserveGroupHeader
                  expanded={observeExpanded}
                  count={observeRows.length}
                  unread={observeUnread}
                  onToggleExpanded={wechatUiStore.setObserveExpanded}
                />
                {observeExpanded
                  ? observeRows.map((entry) => (
                      <ObserveRow
                        key={entry.peer.key}
                        entry={entry}
                        active={selectedPeer?.key === entry.peer.key}
                        onPress={openChat}
                      />
                    ))
                  : null}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
      {error ? (
        <View style={styles.errorBar}>
          <ThemedWarning size={14} uniProps={amberIcon} />
          <Text style={styles.errorText} numberOfLines={1}>
            {t(error)}
          </Text>
          <ToolbarButton label={t("agentChat.msg.retry")} onPress={refresh}>
            <ThemedRefresh size={14} uniProps={mutedIcon} />
          </ToolbarButton>
        </View>
      ) : null}
    </View>
  );
}

/** 会话循环移动的下一个下标：未选中时从头/尾进入，选中后按 delta 环绕 */
function nextConversationIndex(currentIndex: number, delta: 1 | -1, length: number): number {
  if (currentIndex < 0) return delta > 0 ? 0 : length - 1;
  return (currentIndex + delta + length) % length;
}

export function WeChatMain(): ReactElement {
  const { t } = useTranslation();
  const hosts = useHosts();
  const serverId = hosts[0]?.serverId ?? "";
  const selectedPeer = useWeChatSelectedPeer();
  const mode = useTopLevelMode();
  const sidebarSearch = useSidebarSearch();
  const directoryOpen = useDirectoryOpen();
  const directoryFilter = useDirectoryFilter();
  const { conversations, peers, status } = useWeChatData();
  const directoryGroups = useMemo(
    () => buildDirectoryGroups(peers, status, conversations),
    [conversations, peers, status],
  );
  const openDirectoryEntry = useCallback((entry: DirectoryEntry) => {
    if (!entry.key || entry.disabled) return;
    topLevelModeStore.selectPeer({ key: entry.key, title: entry.title, kind: entry.kind });
    wechatUiStore.closeDirectory();
  }, []);
  const moveConversation = useCallback(
    (delta: 1 | -1) => {
      const rows = conversations.filter((entry) => entry.peer.kind !== "observe");
      if (rows.length === 0) return;
      const currentIndex = rows.findIndex((entry) => entry.peer.key === selectedPeer?.key);
      const nextIndex = nextConversationIndex(currentIndex, delta, rows.length);
      const next = rows[nextIndex]!;
      topLevelModeStore.selectPeer({ ...next.peer });
    },
    [conversations, selectedPeer?.key],
  );
  useKeyboardActionHandler({
    handlerId: "wechat-main",
    actions: [
      "wechat.search.focus",
      "wechat.new-chat",
      "wechat.escape",
      "wechat.conv.next",
      "wechat.conv.prev",
    ],
    enabled: mode === "wechat",
    priority: 100,
    handle: (action) => {
      if (action.id === "wechat.search.focus") {
        wechatUiStore.focusSearch();
        return true;
      }
      if (action.id === "wechat.new-chat") {
        wechatUiStore.openDirectory();
        return true;
      }
      if (action.id === "wechat.escape") {
        if (directoryOpen) {
          wechatUiStore.closeDirectory();
          return true;
        }
        if (sidebarSearch) {
          wechatUiStore.setSearch("");
          return true;
        }
        if (typeof HTMLElement !== "undefined" && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
          return true;
        }
        return false;
      }
      if (action.id === "wechat.conv.next") {
        moveConversation(1);
        return true;
      }
      if (action.id === "wechat.conv.prev") {
        moveConversation(-1);
        return true;
      }
      return false;
    },
  });

  return (
    <View style={styles.mainFill}>
      {selectedPeer ? (
        <AgentChatScreen
          serverId={serverId}
          peerKey={selectedPeer.key}
          title={selectedPeer.title}
          kind={selectedPeer.kind}
        />
      ) : (
        <View style={styles.welcome}>
          <Image
            source={require("../../../assets/images/yuyi-logo.png")}
            resizeMode="contain"
            style={styles.welcomeLogo}
          />
          <Text style={styles.welcomeTitle}>{t("wechat.welcomeTitle")}</Text>
          <Text style={styles.welcomeSubtitle}>{t("wechat.welcomeSubtitle")}</Text>
          <PressHighlight
            style={styles.welcomeCta}
            highlightStyle={styles.welcomeCtaPressed}
            onPress={wechatUiStore.openDirectory}
            accessibilityRole="button"
          >
            <ThemedPlus size={16} uniProps={accentForegroundIcon} />
            <Text style={styles.welcomeCtaText}>{t("wechat.contactAgent")}</Text>
          </PressHighlight>
        </View>
      )}
      <DirectoryOverlay
        visible={directoryOpen}
        groups={directoryGroups}
        filter={directoryFilter}
        onFilterChange={wechatUiStore.setDirectoryFilter}
        onPick={openDirectoryEntry}
        onClose={wechatUiStore.closeDirectory}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  sidebar: { flex: 1 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[2],
  },
  searchPill: {
    flex: 1,
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface3,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[3],
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  newChatButton: { backgroundColor: theme.colors.accent, borderRadius: theme.borderRadius.full },
  listScroll: { flex: 1 },
  listContent: { paddingBottom: theme.spacing[6] },
  groupTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[1],
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingRight: theme.spacing[3],
    marginHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  emptyHint: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  agentGroup: { marginBottom: theme.spacing[1] },
  chatRow: {
    marginHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[2],
    position: "relative",
  },
  chatRowHover: { backgroundColor: theme.colors.surfaceSidebarHover },
  unreadRow: { backgroundColor: theme.colors.surfaceSidebarSelected },
  unreadStrip: {
    position: "absolute",
    left: 0,
    top: 12,
    bottom: 12,
    width: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.amber[500],
  },
  chatRowMain: { flex: 1, minWidth: 0 },
  chatRowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  chatRowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    flexShrink: 1,
  },
  chatRowTime: { color: theme.colors.foregroundExtraMuted, fontSize: theme.fontSize.sm },
  chatRowBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginTop: 2,
  },
  chatRowSub: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, flex: 1 },
  badge: {
    backgroundColor: theme.colors.statusDangerTint,
    borderRadius: theme.borderRadius.full,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[1],
  },
  badgeText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.code,
    fontWeight: theme.fontWeight.medium,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusDotSuccess,
  },
  observeRow: { opacity: 0.72 },
  observeUnreadDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundExtraMuted,
  },
  sessionRow: {
    marginLeft: 56,
    marginRight: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    flexDirection: "row",
    justifyContent: "space-between",
    borderRadius: theme.borderRadius.md,
  },
  sessionName: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, flex: 1 },
  sessionUnread: { color: theme.colors.statusDanger, fontSize: theme.fontSize.code },
  searchResults: { paddingBottom: theme.spacing[3] },
  searchResult: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    marginHorizontal: theme.spacing[2],
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  searchEmpty: {
    margin: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface3,
  },
  errorBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  errorText: { flex: 1, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  mainFill: { flex: 1 },
  welcome: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: theme.spacing[16],
    paddingHorizontal: theme.spacing[6],
  },
  welcomeLogo: { width: 64, height: 64, marginBottom: theme.spacing[6] },
  welcomeTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["3xl"],
    fontWeight: theme.fontWeight.semibold,
  },
  welcomeSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    marginTop: theme.spacing[2],
    textAlign: "center",
  },
  welcomeCta: {
    height: 44,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    marginTop: theme.spacing[8],
    paddingHorizontal: theme.spacing[6],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  welcomeCtaPressed: { opacity: theme.opacity[50] },
  welcomeCtaText: {
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
}));
