import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  AlertTriangle,
  Bell,
  BellOff,
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
import { useHostRouteServerId } from "@/navigation/host-route-context";
import { createYuyiClient, type YuyiChatEntry, type YuyiClient } from "@/yuyi/api";
import {
  useDirectoryFilter,
  useDirectoryOpen,
  useConversationFilter,
  useObserveExpanded,
  usePeerMuted,
  useSearchFocusVersion,
  useSidebarSearch,
  useTopLevelMode,
  useWeChatSelectedPeer,
  useWeChatSelectedTask,
  useWeChatSelectedApproval,
  topLevelModeStore,
  wechatUiStore,
  type WeChatSelectedPeer,
} from "@/stores/wechat-mode-store";
import { useWeChatData } from "@/stores/wechat-data-store";
import { useTaskConversation } from "@/stores/wechat-task-store";
import { useApproval, useApprovals } from "@/stores/wechat-approval-store";
import { TaskConversationView } from "./task-conversation-view";
import { ApprovalCard } from "./approval-card";
import { useWeChatMessageSearch } from "@/stores/wechat-search-store";
import { classifyDelivery } from "@/yuyi/delivery-states";
import type { Theme } from "@/styles/theme";
import { DirectoryOverlay } from "./directory-overlay";
import { AgentAvatar } from "./agent-avatar";
import { ConversationActions } from "./conversation-actions";
import { MessageSearchResults } from "./message-search-results";
import { isPeerStillAvailable } from "./chat-navigation";
import {
  agentIdFromPeerKey,
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
const ThemedBell = withUnistyles(Bell);
const ThemedBellOff = withUnistyles(BellOff);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });
const amberIcon = (theme: Theme) => ({ color: theme.colors.palette.amber[500] });
const accentForegroundIcon = (theme: Theme) => ({ color: theme.colors.accentForeground });

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function relativeTime(at: number, t: Translate, locale?: string): string {
  const diff = Math.max(0, Date.now() - at);
  if (diff < 60_000) return t("wechat.time.now");
  if (diff < 3_600_000) return t("wechat.time.minutes", { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("wechat.time.hours", { count: Math.floor(diff / 3_600_000) });
  if (diff < 172_800_000) return t("wechat.time.yesterday");
  return new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(at);
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
  client,
  onOpen,
  onToggle,
  onChanged,
  onDeleted,
}: {
  row: AgentConversationRow;
  activeKey?: string;
  expanded: boolean;
  online: boolean;
  client?: YuyiClient;
  onOpen: (entry: YuyiChatEntry) => void;
  onToggle: (agentId: string) => void;
  onChanged: () => void | Promise<void>;
  onDeleted: (entry: YuyiChatEntry) => void;
}): ReactElement {
  const { t, i18n } = useTranslation();
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
    <View style={styles.agentGroup} nativeID={`wechat-agent-${row.agentId}`}>
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
            <Text
              style={[styles.chatRowTime, row.unread > 0 && styles.chatRowTimeUnread]}
              numberOfLines={1}
            >
              {relativeTime(row.lastAt, t, i18n.language)}
            </Text>
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
      {client ? (
        <ConversationActions
          entry={representative}
          client={client}
          onChanged={onChanged}
          onDeleted={onDeleted}
        />
      ) : null}
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
  client,
}: {
  entry: YuyiChatEntry;
  active: boolean;
  onPress: (entry: YuyiChatEntry) => void;
  client?: YuyiClient;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const handlePress = useCallback(() => onPress(entry), [entry, onPress]);
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  const muted = usePeerMuted(entry.peer.key);
  const toggleMute = useCallback(() => {
    wechatUiStore.togglePeerMuted(entry.peer.key, client);
  }, [client, entry.peer.key]);
  return (
    <PressHighlight
      style={[styles.chatRow, styles.observeRow, muted && styles.observeRowMuted]}
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
      <ToolbarButton label={muted ? t("wechat.unmute") : t("wechat.mute")} onPress={toggleMute}>
        {muted ? (
          <ThemedBell size={13} uniProps={mutedIcon} />
        ) : (
          <ThemedBellOff size={13} uniProps={mutedIcon} />
        )}
      </ToolbarButton>
      <Text style={styles.chatRowTime} numberOfLines={1}>
        {relativeTime(entry.lastAt, t, i18n.language)}
      </Text>
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
  const serverId = useHostRouteServerId() ?? undefined;
  const hosts = useHosts();
  const host = serverId ? hosts.find((item) => item.serverId === serverId) : hosts[0];
  const client = useMemo(() => (host ? createYuyiClient(host) : undefined), [host]);
  const { conversations, peers, status, error, refresh } = useWeChatData(serverId);
  const selectedPeer = useWeChatSelectedPeer();
  const conversationFilter = useConversationFilter();
  const messageSearch = useWeChatMessageSearch(serverId, search);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const visibleConversations = useMemo(
    () =>
      conversations.filter((entry) => {
        if (conversationFilter === "archived") return entry.archivedAt !== undefined;
        if (entry.archivedAt !== undefined) return false;
        if (conversationFilter === "local") {
          return Boolean(
            status?.bindings.some(
              (binding) => binding.agentId === agentIdFromPeerKey(entry.peer.key),
            ),
          );
        }
        return true;
      }),
    [conversationFilter, conversations, status],
  );
  const agentRows = useMemo(() => groupAgentRows(visibleConversations), [visibleConversations]);
  const taskRows = useMemo(
    () => visibleConversations.filter((entry) => entry.peer.kind === "task"),
    [visibleConversations],
  );
  const observeRows = useMemo(
    () => visibleConversations.filter((entry) => entry.peer.kind === "observe"),
    [visibleConversations],
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
  useEffect(() => {
    if (!selectedPeer) return;
    const id = `wechat-agent-${agentIdFromPeerKey(selectedPeer.key)}`;
    document.getElementById(id)?.scrollIntoView({ block: "nearest" });
  }, [selectedPeer]);

  const openChat = useCallback(
    (entry: YuyiChatEntry) => {
      topLevelModeStore.selectPeer({ ...entry.peer, serverId });
      wechatUiStore.setSearch("");
    },
    [serverId],
  );
  const openTask = useCallback(
    (entry: YuyiChatEntry) => {
      topLevelModeStore.selectTask({
        rootTaskId: entry.peer.key.slice(5),
        title: entry.peer.title,
        serverId,
      });
      wechatUiStore.setSearch("");
    },
    [serverId],
  );
  const openMessage = useCallback(
    (target: { serverId: string; peerKey: string; messageId: string }) => {
      const conversation = conversations.find((entry) => entry.peer.key === target.peerKey);
      wechatUiStore.openMessageResult({
        ...target,
        title: conversation?.peer.title,
        kind: conversation?.peer.kind,
      });
      wechatUiStore.setSearch("");
    },
    [conversations],
  );
  const deleteConversation = useCallback(
    (entry: YuyiChatEntry) => {
      if (selectedPeer?.key === entry.peer.key) topLevelModeStore.selectPeer(null);
      return refresh();
    },
    [refresh, selectedPeer],
  );
  const openAgent = useCallback(
    (entry: DirectoryEntry) => {
      if (!entry.key || entry.disabled) return;
      topLevelModeStore.selectPeer({
        key: entry.key,
        title: entry.title,
        kind: entry.kind,
        serverId,
      });
      wechatUiStore.setSearch("");
    },
    [serverId],
  );
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
      <View style={styles.filterRow}>
        {(["all", "local", "archived"] as const).map((filter) => (
          <ConversationFilterChip
            key={filter}
            filter={filter}
            selected={conversationFilter === filter}
          />
        ))}
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
            <MessageSearchResults
              results={messageSearch.results}
              serverId={serverId ?? ""}
              onOpen={openMessage}
            />
            {searchResults.conversations.length +
              searchResults.agents.length +
              messageSearch.results.length ===
            0 ? (
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
                client={client}
                onOpen={openChat}
                onToggle={toggleAgent}
                onChanged={refresh}
                onDeleted={deleteConversation}
              />
            ))}
            {taskRows.map((entry) => (
              <TaskRowItem key={entry.peer.key} entry={entry} onOpen={openTask} />
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
                        client={client}
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

function WeChatApprovalOverlay({ serverId }: { serverId: string }): ReactElement | null {
  const approvalId = useWeChatSelectedApproval();
  const approval = useApproval(approvalId, serverId);
  const actions = useApprovals(serverId);
  const resolve = useCallback(
    (decision: "approved" | "denied", note?: string) =>
      approvalId
        ? actions.resolve(approvalId, decision, note)
        : Promise.resolve({ ok: false, detail: "approval missing" }),
    [actions, approvalId],
  );
  if (!approvalId || !approval) return null;
  return (
    <View style={styles.approvalOverlay}>
      <ApprovalCard approval={approval} onResolve={resolve} onClose={wechatUiStore.closeApproval} />
    </View>
  );
}

// 会话筛选 chip：列表 per-item 回调/对象提取为子组件
function ConversationFilterChip({
  filter,
  selected,
}: {
  filter: "all" | "local" | "archived";
  selected: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const handlePress = useCallback(() => wechatUiStore.setConversationFilter(filter), [filter]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <PressHighlight
      style={[styles.filterItem, selected && styles.filterItemSelected]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
    >
      <Text style={styles.filterText}>{t(`wechat.filter.${filter}`)}</Text>
    </PressHighlight>
  );
}

// 任务会话行：列表 per-item 回调提取为子组件
function TaskRowItem({
  entry,
  onOpen,
}: {
  entry: YuyiChatEntry;
  onOpen: (entry: YuyiChatEntry) => void;
}): ReactElement {
  const handlePress = useCallback(() => onOpen(entry), [entry, onOpen]);
  return (
    <PressHighlight
      style={styles.chatRow}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={entry.peer.title}
    >
      <AgentAvatar kind="task" />
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

// 主区内容：早返回子组件替代嵌套三元（任务会话 → 单聊 → 欢迎页）
function WeChatMainPane({
  selectedTask,
  selectedPeer,
  serverId,
  participantIntent,
  onOpenTaskMember,
}: {
  selectedTask: { rootTaskId: string; title: string; serverId?: string } | null;
  selectedPeer: WeChatSelectedPeer | null;
  serverId: string;
  participantIntent: string[] | undefined;
  onOpenTaskMember: (agentId: string) => void;
}): ReactElement {
  if (selectedTask) {
    return (
      <TaskConversationRoute
        rootTaskId={selectedTask.rootTaskId}
        title={selectedTask.title}
        serverId={serverId}
        participantIntent={participantIntent}
        onOpenMember={onOpenTaskMember}
      />
    );
  }
  if (selectedPeer) {
    return (
      <AgentChatScreen
        serverId={serverId}
        peerKey={selectedPeer.key}
        title={selectedPeer.title}
        kind={selectedPeer.kind}
      />
    );
  }
  return <WeChatWelcomePane />;
}

function WeChatWelcomePane(): ReactElement {
  const { t } = useTranslation();
  return (
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
      <Text style={styles.welcomeHint}>{t("wechat.welcomeHint")}</Text>
    </View>
  );
}

function TaskConversationRoute({
  rootTaskId,
  title,
  serverId,
  participantIntent,
  onOpenMember,
}: {
  rootTaskId: string;
  title: string;
  serverId: string;
  participantIntent?: string[];
  onOpenMember: (agentId: string) => void;
}): ReactElement {
  const snapshot = useTaskConversation(rootTaskId, serverId);
  return (
    <TaskConversationView
      rootTaskId={rootTaskId}
      title={title}
      task={snapshot.task}
      messages={snapshot.messages}
      participantIntent={participantIntent}
      onBroadcast={snapshot.broadcast}
      onOpenMember={onOpenMember}
    />
  );
}

export function WeChatMain({ serverId: routeServerId }: { serverId?: string } = {}): ReactElement {
  const { t } = useTranslation();
  const hosts = useHosts();
  const serverId = routeServerId ?? hosts[0]?.serverId ?? "";
  const selectedPeer = useWeChatSelectedPeer();
  const selectedTask = useWeChatSelectedTask();
  const [taskIntents, setTaskIntents] = useState<Record<string, string[]>>({});
  const mode = useTopLevelMode();
  const sidebarSearch = useSidebarSearch();
  const directoryOpen = useDirectoryOpen();
  const directoryFilter = useDirectoryFilter();
  const { conversations, peers, status, loaded, error } = useWeChatData(serverId);
  const directoryGroups = useMemo(
    () => buildDirectoryGroups(peers, status, conversations),
    [conversations, peers, status],
  );
  useEffect(() => {
    if (!loaded || error || !selectedPeer) return;
    if (selectedPeer.serverId && selectedPeer.serverId !== serverId) {
      topLevelModeStore.selectPeer(null);
      return;
    }
    if (!isPeerStillAvailable(selectedPeer, conversations, peers, status)) {
      topLevelModeStore.selectPeer(null);
    }
  }, [conversations, error, loaded, peers, selectedPeer, serverId, status]);
  const openDirectoryEntry = useCallback(
    (entry: DirectoryEntry) => {
      if (!entry.key || entry.disabled) return;
      topLevelModeStore.selectPeer({
        key: entry.key,
        title: entry.title,
        kind: entry.kind,
        serverId,
      });
      wechatUiStore.closeDirectory();
    },
    [serverId],
  );
  const createTaskBroadcast = useCallback(
    (entries: DirectoryEntry[]) => {
      const rootTaskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      setTaskIntents((current) => ({
        ...current,
        [rootTaskId]: entries
          .map((entry) => entry.key?.split(":")[0])
          .filter((value): value is string => Boolean(value)),
      }));
      topLevelModeStore.selectTask({
        rootTaskId,
        title: t("wechat.createTaskBroadcast"),
        serverId,
      });
      wechatUiStore.closeDirectory();
    },
    [serverId, t],
  );
  const openTaskMember = useCallback(
    (agentId: string) => {
      const conversation = conversations.find(
        (entry) =>
          (entry.peer.kind === "agent" || entry.peer.kind === "owner") &&
          agentIdFromPeerKey(entry.peer.key) === agentId,
      );
      const peer = peers?.find((candidate) => candidate.agentId === agentId);
      const session = peer?.sessions.find((candidate) => candidate.name);
      const key =
        conversation?.peer.key ??
        (peer?.agentId && session?.name ? `${peer.agentId}:${session.name}` : null);
      if (key)
        topLevelModeStore.selectPeer({
          key,
          title: conversation?.peer.title ?? session?.title ?? agentId,
          kind: conversation?.peer.kind ?? "agent",
          serverId,
        });
    },
    [conversations, peers, serverId],
  );
  const moveConversation = useCallback(
    (delta: 1 | -1) => {
      const rows = conversations.filter(
        (entry) => entry.peer.kind === "agent" || entry.peer.kind === "owner",
      );
      if (rows.length === 0) return;
      const currentIndex = rows.findIndex((entry) => entry.peer.key === selectedPeer?.key);
      const nextIndex = nextConversationIndex(currentIndex, delta, rows.length);
      const next = rows[nextIndex]!;
      topLevelModeStore.selectPeer({ ...next.peer, serverId });
    },
    [conversations, selectedPeer?.key, serverId],
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
      <WeChatMainPane
        selectedTask={selectedTask}
        selectedPeer={selectedPeer}
        serverId={serverId}
        participantIntent={selectedTask ? taskIntents[selectedTask.rootTaskId] : undefined}
        onOpenTaskMember={openTaskMember}
      />
      <DirectoryOverlay
        visible={directoryOpen}
        groups={directoryGroups}
        filter={directoryFilter}
        onFilterChange={wechatUiStore.setDirectoryFilter}
        onPick={openDirectoryEntry}
        onClose={wechatUiStore.closeDirectory}
        onCreateTask={createTaskBroadcast}
      />
      <WeChatApprovalOverlay serverId={serverId} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  sidebar: { flex: 1 },
  approvalOverlay: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 360,
    maxWidth: "90%",
    zIndex: 20,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[2],
  },
  filterRow: {
    flexDirection: "row",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  filterItem: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  filterItemSelected: { backgroundColor: theme.colors.surfaceSidebarSelected },
  filterText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
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
  chatRowTime: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
  chatRowTimeUnread: { color: theme.colors.foreground },
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
  observeRowMuted: { opacity: theme.opacity[50] },
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
  welcomeHint: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.code,
    marginTop: theme.spacing[3],
  },
}));
