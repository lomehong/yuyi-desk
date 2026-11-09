import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Clock,
  CornerUpLeft,
  Mail,
  MoreHorizontal,
  Send,
  Trash2,
  XCircle,
} from "lucide-react-native";
import { router } from "expo-router";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { PressHighlight } from "@/components/ui/press-highlight";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHosts } from "@/runtime/host-runtime";
import {
  createYuyiClient,
  type YuyiChatEntry,
  type YuyiChatMessage,
  type YuyiTaskIndex,
  type YuyiTurnOutcome,
  type YuyiTurnProjection,
} from "@/yuyi/api";
import { TaskSegmentList } from "@/components/wechat/task-segment-list";
import {
  messageDeliveryState,
  reconcilePendingMessages,
  type DeliveryAck,
  type DeliveryKind,
} from "@/yuyi/delivery-states";
import { draftStore } from "@/stores/wechat-draft-store";
import { topLevelModeStore, useMessageTarget, wechatUiStore } from "@/stores/wechat-mode-store";
import { useWeChatData } from "@/stores/wechat-data-store";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import type { Theme } from "@/styles/theme";
import { AgentAvatar } from "@/components/wechat/agent-avatar";
import { AgentIdentityBadge } from "@/components/wechat/agent-identity-badge";
import { ForwardSheet } from "@/components/wechat/forward-sheet";
import {
  buildForwardSnapshot,
  groupObservedTurns,
  ResultCard,
  type ObservedTurn,
} from "@/components/wechat/result-card";
import { agentIdFromPeerKey, type DirectoryEntry } from "@/components/wechat/wechat-model";
import { splitUnreadMessages } from "@/components/wechat/chat-navigation";
import { LinkifiedText } from "@/components/wechat/linkified-text";
import { clearDraftForPeer, quoteReplyDraft } from "@/components/wechat/composer-actions";
import { buildMessageGroups, type MessageGroup } from "./message-groups";

const ThemedSend = withUnistyles(Send);
const ThemedChevron = withUnistyles(ChevronDown);
const ThemedClock = withUnistyles(Clock);
const ThemedCheck = withUnistyles(Check);
const ThemedMail = withUnistyles(Mail);
const ThemedFailure = withUnistyles(XCircle);
const ThemedMore = withUnistyles(MoreHorizontal);
const ThemedQuote = withUnistyles(CornerUpLeft);
const ThemedClear = withUnistyles(Trash2);
const ThemedWorkbench = withUnistyles(ArrowLeftRight);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });
const sendIcon = (theme: Theme) => ({ color: theme.colors.accentForeground });
const failIcon = (theme: Theme) => ({ color: theme.colors.statusDanger });
// 模块级静态图标元素：编辑器动作图标完全静态，避免 JSX 内联进 prop
const quoteActionIcon = <ThemedQuote size={14} uniProps={mutedIcon} />;
const clearActionIcon = <ThemedClear size={14} uniProps={mutedIcon} />;
const workbenchActionIcon = <ThemedWorkbench size={14} uniProps={mutedIcon} />;

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface ChatScrollEvent {
  nativeEvent: {
    contentOffset: { y: number };
    contentSize: { height: number };
    layoutMeasurement: { height: number };
  };
}

interface InputKeyPressEvent {
  nativeEvent?: { key?: string; shiftKey?: boolean; keyCode?: number };
  preventDefault?: () => void;
}

function resolvePeerKind(kind?: string): "owner" | "agent" | "observe" {
  if (kind === "owner") return "owner";
  if (kind === "observe") return "observe";
  return "agent";
}

function hasReplyAfter(messages: YuyiChatMessage[], msg: YuyiChatMessage): boolean {
  const index = messages.findIndex((message) => message.id === msg.id);
  return messages.some(
    (message, messageIndex) =>
      message.dir === "in" &&
      (messageIndex > index || (msg.hubId !== undefined && message.replyTo === msg.hubId)),
  );
}

/** 头部在线状态文案：未知/离线/多端/在线（早返回拆开，避免嵌套三元） */
function peerStatusText(peerOnline: boolean | null, deviceCount: number, t: Translate): string {
  if (peerOnline === null) return t("agentChat.peer.unknown");
  if (!peerOnline) return t("agentChat.peer.offline");
  if (deviceCount > 1) return t("agentChat.peer.multiDevice", { count: deviceCount });
  return t("agentChat.peer.online");
}

/** 空会话教育文案 key（早返回拆开，避免嵌套三元） */
function emptyEducationKey(readOnly: boolean, isLocal: boolean): string {
  if (readOnly) return "wechat.observeEducation";
  if (isLocal) return "wechat.localEducation";
  return "wechat.remoteEducation";
}

/** 乐观气泡的 ack 快照（早返回拆开，避免嵌套三元） */
function pendingAck(item: PendingMessage): DeliveryAck | undefined {
  if (item.failed) return { ok: false, delivery: "failed" };
  if (item.delivery) return { ok: true, delivery: item.delivery };
  return undefined;
}

/** 气泡投递状态：入向无状态；乐观失败优先，其余走状态机（早返回拆开，避免嵌套三元） */
function bubbleDelivery(
  msg: YuyiChatMessage,
  now: number,
  pendingFailed: boolean | undefined,
  hasReply: boolean | undefined,
  peerBusy: boolean | null | undefined,
  turnOutcome: YuyiTurnOutcome | undefined,
): DeliveryKind | null {
  if (msg.dir !== "out") return null;
  if (pendingFailed) return "failed";
  return messageDeliveryState(msg, now, { hasReply, peerBusy, turnOutcome });
}

interface PendingMessage {
  tempId: string;
  text: string;
  sentAt: number;
  messageId?: string;
  delivery?: "injected" | "mailed" | "delivered" | "failed";
  ackAt?: number;
  failed?: boolean;
}

function performSend(
  client: NonNullable<ReturnType<typeof createYuyiClient>>,
  peerKey: string,
  text: string,
  setPending: React.Dispatch<React.SetStateAction<PendingMessage[]>>,
  refresh: () => Promise<void>,
  onSuccess: () => void,
  onSettled: () => void,
): void {
  const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  setPending((items) => [...items, { tempId, text, sentAt: Date.now() }]);
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("send timeout")), 8_000);
  });
  void Promise.race([client.chats.sendChat(peerKey, text), timeoutPromise])
    .then((res) => {
      const delivery = res.delivery ?? (res.ok ? undefined : "failed");
      setPending((items) =>
        items.map((item) =>
          item.tempId === tempId
            ? {
                ...item,
                messageId: res.messageId,
                delivery,
                ackAt: Date.now(),
                failed: delivery === "failed",
              }
            : item,
        ),
      );
      if (res.ok) onSuccess();
      return refresh();
    })
    .catch(() => {
      setPending((items) =>
        items.map((item) => (item.tempId === tempId ? { ...item, failed: true } : item)),
      );
    })
    .finally(() => {
      if (timeout) clearTimeout(timeout);
      onSettled();
    });
}

export function AgentChatScreen({
  serverId,
  peerKey,
  title,
  kind: peerKindProp,
}: {
  serverId: string;
  peerKey: string;
  title?: string;
  kind?: string;
}): ReactElement {
  const { t } = useTranslation();
  const hosts = useHosts();
  const host = hosts.find((item) => item.serverId === serverId);
  const client = useMemo(() => (host ? createYuyiClient(host) : null), [host]);
  const { conversations, peers, status, eventRevision, eventPeerKey, turnsByReplyTo } =
    useWeChatData(serverId);
  const peerKind = resolvePeerKind(peerKindProp);
  const readOnly = peerKind === "observe";
  const peerTitle = title ?? peerKey;
  const agentId = agentIdFromPeerKey(peerKey);
  const matchingPeers = useMemo(
    () => (peers ?? []).filter((peer) => peer.agentId === agentId),
    [agentId, peers],
  );
  const peerOnline = peers === null ? null : matchingPeers.length > 0;
  const activity = matchingPeers.find((peer) => peer.activity)?.activity;
  const currentConversation = conversations.find((entry) => entry.peer.key === peerKey);
  const sessionOptions = useMemo(
    () =>
      conversations.filter(
        (entry) => entry.peer.kind !== "observe" && agentIdFromPeerKey(entry.peer.key) === agentId,
      ),
    [agentId, conversations],
  );
  const role = currentConversation?.peer.role ?? matchingPeers[0]?.role;
  const isLocal = Boolean(status?.bindings.some((binding) => binding.agentId === agentId));
  const device = matchingPeers[0]?.device ?? status?.device;

  const [messages, setMessages] = useState<YuyiChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnBusy, setTurnBusy] = useState<boolean | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [newCount, setNewCount] = useState(0);
  const [forwardTurn, setForwardTurn] = useState<ObservedTurn | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const messageTarget = useMessageTarget();
  const scrollRef = useRef<ScrollView>(null);
  const composerRef = useRef<EditingTextInputHandle>(null);
  const wasNearBottom = useRef(true);
  const lastFingerprint = useRef("");
  const messagesLengthRef = useRef(0);
  const unreadAtOpen = useRef(0);
  const restoreScrollPending = useRef(false);
  const latestProtocolTurn = messages.reduce<YuyiTurnProjection | undefined>((latest, message) => {
    const turn = message.hubId ? turnsByReplyTo[message.hubId] : undefined;
    return turn && (!latest || turn.at > latest.at) ? turn : latest;
  }, undefined);
  const protocolBusy = latestProtocolTurn
    ? latestProtocolTurn.outcome === "started" ||
      latestProtocolTurn.outcome === "waiting-permission"
    : null;
  const peerBusy = protocolBusy ?? turnBusy ?? activity?.busy ?? null;

  const refresh = useCallback(async () => {
    if (!client || !peerKey) return;
    try {
      const result = await client.chats.fetchChatHistory(peerKey);
      setError(null);
      setPending((items) => reconcilePendingMessages(items, result.messages));
      void client.chats
        .fetchChatTurns(peerKey)
        .then((turns) => setTurnBusy(turns.busy))
        .catch(() => setTurnBusy(null));
      const last = result.messages[result.messages.length - 1];
      const fingerprint = `${result.messages.length}:${last?.id ?? ""}`;
      if (fingerprint === lastFingerprint.current) return;
      lastFingerprint.current = fingerprint;
      if (wasNearBottom.current) {
        setMessages(result.messages);
        setNewCount(0);
      } else {
        const grown = result.messages.length - messagesLengthRef.current;
        setMessages(result.messages);
        if (grown > 0) setNewCount((count) => count + grown);
      }
      messagesLengthRef.current = result.messages.length;
    } catch {
      setError("wechat.errorConnection");
    }
  }, [client, peerKey]);

  useEffect(() => {
    if (!client || !messageTarget || messageTarget.peerKey !== peerKey) return;
    let cancelled = false;
    let highlightTimer: ReturnType<typeof setTimeout> | null = null;
    void client.chats
      .fetchChatHistory(peerKey, 200, messageTarget.messageId)
      .then((result) => {
        if (cancelled) return undefined;
        setError(null);
        setMessages(result.messages);
        setPending((items) => reconcilePendingMessages(items, result.messages));
        setHighlightedMessageId(messageTarget.messageId);
        messagesLengthRef.current = result.messages.length;
        requestAnimationFrame(() => {
          document.getElementById(`wechat-message-${messageTarget.messageId}`)?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
          wechatUiStore.clearMessageTarget();
        });
        highlightTimer = setTimeout(() => setHighlightedMessageId(null), 1600);
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setError("wechat.errorConnection");
      });
    return () => {
      cancelled = true;
      if (highlightTimer) clearTimeout(highlightTimer);
    };
  }, [client, messageTarget, peerKey]);

  useEffect(() => {
    if (!client || !peerKey) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (cancelled) return;
      const interval = document.visibilityState === "visible" ? 3_000 : 15_000;
      void refresh().finally(() => {
        if (!cancelled) timer = setTimeout(tick, interval);
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    void refresh().finally(() => {
      if (!cancelled) timer = setTimeout(tick, 3_000);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [client, peerKey, refresh]);

  useEffect(() => {
    if (eventRevision > 0 && (eventPeerKey === peerKey || eventPeerKey === "*")) void refresh();
  }, [eventRevision, eventPeerKey, peerKey, refresh]);

  useEffect(() => {
    lastFingerprint.current = "";
    messagesLengthRef.current = 0;
    unreadAtOpen.current = 0;
    restoreScrollPending.current = true;
    setMessages([]);
    setPending([]);
    setTurnBusy(null);
    const savedPosition = wechatUiStore.getScrollPosition(peerKey);
    wasNearBottom.current = savedPosition === 0;
    const saved = readOnly ? "" : draftStore.get(peerKey);
    setDraft(saved);
  }, [peerKey, readOnly]);

  useEffect(() => {
    if ((currentConversation?.unread ?? 0) > 0) {
      unreadAtOpen.current = Math.max(unreadAtOpen.current, currentConversation!.unread);
    }
  }, [currentConversation]);

  useEffect(() => {
    if (!client || !peerKey) return;
    void client.chats.markChatRead(peerKey).catch(() => undefined);
  }, [client, peerKey]);

  const hasProcessing = useMemo(
    () =>
      messages.some((message) => {
        if (message.dir !== "out") return false;
        return (
          messageDeliveryState(message, now, {
            hasReply: hasReplyAfter(messages, message),
            peerBusy,
          }) === "injected"
        );
      }),
    [messages, now, peerBusy],
  );
  const needsClock =
    hasProcessing ||
    pending.some((item) => !item.failed && (!item.delivery || item.delivery === "injected"));
  useEffect(() => {
    if (!needsClock) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [needsClock]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || sending || !client || !peerKey || readOnly) return;
    setNow(Date.now());
    setSending(true);
    performSend(
      client,
      peerKey,
      text,
      setPending,
      refresh,
      () => {
        draftStore.clear(peerKey);
        setDraft("");
        composerRef.current?.reset();
      },
      () => setSending(false),
    );
  }, [client, draft, peerKey, readOnly, refresh, sending]);

  const retryText = useCallback(
    (text: string) => {
      if (!client || !peerKey || sending) return;
      setNow(Date.now());
      setSending(true);
      performSend(
        client,
        peerKey,
        text,
        setPending,
        refresh,
        () => undefined,
        () => setSending(false),
      );
    },
    [client, peerKey, refresh, sending],
  );

  const scrollToEnd = useCallback(() => scrollRef.current?.scrollToEnd({ animated: true }), []);
  const handleScroll = useCallback(
    (event: ChatScrollEvent) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      wasNearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 120;
      wechatUiStore.setScrollPosition(peerKey, contentOffset.y);
    },
    [peerKey],
  );
  const onContentSizeChange = useCallback(() => {
    if (restoreScrollPending.current) {
      const saved = wechatUiStore.getScrollPosition(peerKey);
      if (saved > 0) scrollRef.current?.scrollTo({ y: saved, animated: false });
      wasNearBottom.current = saved === 0;
      restoreScrollPending.current = false;
      return;
    }
    if (wasNearBottom.current) scrollToEnd();
  }, [peerKey, scrollToEnd]);
  const jumpToBottom = useCallback(() => {
    setNewCount(0);
    wasNearBottom.current = true;
    scrollToEnd();
  }, [scrollToEnd]);
  const onInputKeyPress = useCallback(
    (event: InputKeyPressEvent) => {
      const keyboard = event.nativeEvent;
      if (!keyboard || keyboard.keyCode === 229) return;
      if (keyboard.key === "Enter" && !keyboard.shiftKey) {
        event.preventDefault?.();
        send();
      }
    },
    [send],
  );
  const onDraftChange = useCallback(
    (text: string) => {
      setDraft(text);
      if (!readOnly && peerKey) draftStore.set(peerKey, text);
    },
    [peerKey, readOnly],
  );
  const openReply = useCallback((messageId: string) => {
    document
      .getElementById(`wechat-message-${messageId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);
  const quoteLastReply = useCallback(() => {
    const reply = messages
      .toReversed()
      .find((message) => message.dir === "in" && message.kind !== "system");
    if (!reply) return;
    const next = quoteReplyDraft(draft, reply.text);
    draftStore.set(peerKey, next);
    setDraft(next);
    composerRef.current?.replaceText(next);
  }, [draft, messages, peerKey]);
  const clearCurrentDraft = useCallback(() => {
    clearDraftForPeer(peerKey);
    setDraft("");
    composerRef.current?.reset();
  }, [peerKey]);
  const copyPeerKey = useCallback(() => {
    void copyToClipboard(peerKey);
  }, [peerKey]);
  const goWorkbench = useCallback(async () => {
    topLevelModeStore.set("workbench");
    if (client) {
      try {
        const location = await client.locateAgent(peerKey.split(":").at(-1) ?? peerKey);
        if (location.found && location.paseoAgentId) {
          navigateToAgent({
            serverId,
            agentId: location.paseoAgentId,
            workspaceId: location.workspaceId,
          });
          return;
        }
      } catch {
        // 定位失败时保留普通工作台回退
      }
    }
    router.push(`/h/${serverId}` as never);
  }, [client, peerKey, serverId]);
  const forwardWholeConversation = useCallback(() => {
    setForwardTurn({ taskId: null, messages, at: messages[0]?.at ?? Date.now() });
  }, [messages]);
  const closeForward = useCallback(() => setForwardTurn(null), []);
  const selectForwardTarget = useCallback(
    (entry: DirectoryEntry) => {
      if (!entry.key) return;
      const turn = forwardTurn;
      const snapshot = buildForwardSnapshot(
        peerTitle,
        turn?.taskId ?? null,
        turn?.messages ?? messages,
      );
      draftStore.set(entry.key, snapshot);
      topLevelModeStore.selectPeer({
        key: entry.key,
        title: entry.title,
        kind: entry.kind,
        serverId,
      });
      setForwardTurn(null);
    },
    [forwardTurn, messages, peerTitle, serverId],
  );
  const groups = useMemo(() => buildMessageGroups(messages), [messages]);
  const observedTurns = useMemo(() => groupObservedTurns(messages), [messages]);
  const fetchTask = useCallback(
    (taskId: string): Promise<{ task?: YuyiTaskIndex }> =>
      client?.chats.fetchTask?.(taskId) ?? Promise.resolve({}),
    [client],
  );
  const firstUnreadId = firstUnreadMessageId(messages, unreadAtOpen.current);
  const selectSession = useCallback(
    (entry: YuyiChatEntry) => {
      topLevelModeStore.selectPeer({ ...entry.peer, serverId });
    },
    [serverId],
  );
  const onlineText = peerStatusText(peerOnline, matchingPeers.length, t);
  const lastReplyText = latestIncomingText(messages);

  return (
    <View style={styles.container}>
      <ChatHeaderPane
        peerKind={peerKind}
        peerTitle={peerTitle}
        peerKey={peerKey}
        sessionOptions={sessionOptions}
        onSelectSession={selectSession}
        role={role}
        isLocal={isLocal}
        device={device}
        readOnly={readOnly}
        peerOnline={peerOnline}
        activity={activity}
        peerBusy={peerBusy}
        onlineText={onlineText}
        onCopyPeerKey={copyPeerKey}
        onGoWorkbench={goWorkbench}
        onRefresh={refresh}
        onForwardWholeConversation={forwardWholeConversation}
      />
      <ChatMessagesPane
        scrollRef={scrollRef}
        onScroll={handleScroll}
        onContentSizeChange={onContentSizeChange}
        readOnly={readOnly}
        isLocal={isLocal}
        peerTitle={peerTitle}
        groups={groups}
        firstUnreadId={firstUnreadId}
        observedTurns={observedTurns}
        fetchTask={fetchTask}
        messages={messages}
        pending={pending}
        now={now}
        highlightedMessageId={highlightedMessageId}
        peerBusy={peerBusy}
        turnsByReplyTo={turnsByReplyTo}
        error={error}
        onRetry={retryText}
        onReplyPress={openReply}
        onForwardTurn={setForwardTurn}
      />
      {newCount > 0 ? <NewMessageCapsule count={newCount} onPress={jumpToBottom} /> : null}
      <ChatComposerPane
        readOnly={readOnly}
        peerKey={peerKey}
        peerTitle={peerTitle}
        peerOnline={peerOnline}
        isLocal={isLocal}
        draft={draft}
        sending={sending}
        inputRef={composerRef}
        lastReplyText={lastReplyText}
        onQuoteReply={quoteLastReply}
        onClearDraft={clearCurrentDraft}
        onGoWorkbench={goWorkbench}
        onDraftChange={onDraftChange}
        onInputKeyPress={onInputKeyPress}
        onSend={send}
        onForwardWholeConversation={forwardWholeConversation}
      />
      <ForwardSheet
        visible={forwardTurn !== null}
        conversations={conversations}
        peers={peers}
        status={status}
        onSelect={selectForwardTarget}
        onClose={closeForward}
      />
    </View>
  );
}

/** 头部区：头像、身份徽章、在线/忙碌/现场行与右上菜单（从 AgentChatScreen 拆出控复杂度） */
export function ChatHeaderPane({
  peerKind,
  peerTitle,
  peerKey,
  sessionOptions,
  onSelectSession,
  role,
  isLocal,
  device,
  readOnly,
  peerOnline,
  activity,
  peerBusy,
  onlineText,
  onCopyPeerKey,
  onGoWorkbench,
  onRefresh,
  onForwardWholeConversation,
}: {
  peerKind: "owner" | "agent" | "observe";
  peerTitle: string;
  peerKey: string;
  sessionOptions: YuyiChatEntry[];
  onSelectSession: (entry: YuyiChatEntry) => void;
  role?: string;
  isLocal: boolean;
  device?: string;
  readOnly: boolean;
  peerOnline: boolean | null;
  activity?: { busy?: boolean; doing?: string; repo?: string };
  peerBusy: boolean | null;
  onlineText: string;
  onCopyPeerKey: () => void;
  onGoWorkbench: () => void;
  onRefresh: () => void | Promise<void>;
  onForwardWholeConversation: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.headerRow}>
      <AgentAvatar kind={peerKind} busy={peerBusy === true} />
      <View style={styles.headerText}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {peerTitle}
          </Text>
          <AgentIdentityBadge role={role} isLocal={isLocal} device={device} />
          {readOnly ? <Text style={styles.observeTag}>{t("agentChat.observeTag")}</Text> : null}
        </View>
        <View style={styles.activityRow}>
          <View
            style={[
              styles.onlineDot,
              peerOnline === null && styles.unknownDot,
              peerOnline === false && styles.offlineDot,
            ]}
          />
          <Text style={styles.onlineText}>{onlineText}</Text>
          {sessionOptions.length > 1 ? (
            <DropdownMenu compactMode="sheet">
              <DropdownMenuTrigger
                accessibilityRole="button"
                accessibilityLabel={t("wechat.switchSession")}
                style={styles.sessionSwitch}
              >
                <View style={styles.sessionSwitchInner}>
                  <Text style={styles.sessionSwitchText}>{peerKey.split(":").at(-1)}</Text>
                  <ThemedChevron size={12} uniProps={mutedIcon} />
                </View>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                minWidth={220}
                sheetTitle={t("wechat.switchSession")}
              >
                {sessionOptions.map((session) => (
                  <SessionMenuItem
                    key={session.peer.key}
                    session={session}
                    selected={session.peer.key === peerKey}
                    onSelectSession={onSelectSession}
                  />
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {peerBusy === true ? (
            <>
              <PulseDot delay={0} running testID="wechat-header-busy-dot" />
              <Text style={styles.busyText}>{t("wechat.busy")}</Text>
            </>
          ) : null}
          {activity?.doing ? (
            <Text style={styles.activityText} numberOfLines={1}>
              {activity.doing}
            </Text>
          ) : null}
          {activity?.repo ? <Text style={styles.activityText}>repo: {activity.repo}</Text> : null}
        </View>
      </View>
      <DropdownMenu compactMode="sheet">
        <DropdownMenuTrigger
          accessibilityRole="button"
          accessibilityLabel={t("wechat.moreActions")}
        >
          <View style={styles.menuButton}>
            <ThemedMore size={18} uniProps={mutedIcon} />
          </View>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" minWidth={220} sheetTitle={peerTitle}>
          <DropdownMenuItem onSelect={onCopyPeerKey}>{t("wechat.copyPeerKey")}</DropdownMenuItem>
          {isLocal && !readOnly ? (
            <DropdownMenuItem onSelect={onGoWorkbench}>{t("wechat.goWorkbench")}</DropdownMenuItem>
          ) : null}
          {readOnly ? (
            <DropdownMenuItem onSelect={onForwardWholeConversation}>
              {t("wechat.forwardIntervene")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={onRefresh}>{t("yuyi.refresh")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

// 最近一条入站消息文本（供“引用回复”入口展示）
function latestIncomingText(messages: YuyiChatMessage[]): string | undefined {
  return messages.toReversed().find((message) => message.dir === "in" && message.kind !== "system")
    ?.text;
}

// 首条未读消息 id（从 AgentChatScreen 提取的纯函数）
function firstUnreadMessageId(
  messages: YuyiChatMessage[],
  unreadAtOpen: number,
): string | undefined {
  return splitUnreadMessages(messages, unreadAtOpen).unread[0]?.id;
}

// 会话切换菜单项：列表 per-item 回调提取为子组件
function SessionMenuItem({
  session,
  selected,
  onSelectSession,
}: {
  session: YuyiChatEntry;
  selected: boolean;
  onSelectSession: (entry: YuyiChatEntry) => void;
}): ReactElement {
  const handleSelect = useCallback(() => onSelectSession(session), [onSelectSession, session]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {session.peer.key.split(":").at(-1)}
    </DropdownMenuItem>
  );
}

/** 消息区：旁观流/分组气泡、乐观气泡、处理中占位、空态与错误行（从 AgentChatScreen 拆出控复杂度） */
function ChatMessagesPane({
  scrollRef,
  onScroll,
  onContentSizeChange,
  readOnly,
  isLocal,
  peerTitle,
  groups,
  firstUnreadId,
  observedTurns,
  fetchTask,
  messages,
  pending,
  now,
  highlightedMessageId,
  peerBusy,
  turnsByReplyTo,
  error,
  onRetry,
  onReplyPress,
  onForwardTurn,
}: {
  scrollRef: { current: ScrollView | null };
  onScroll: (event: ChatScrollEvent) => void;
  onContentSizeChange: () => void;
  readOnly: boolean;
  isLocal: boolean;
  peerTitle: string;
  groups: MessageGroup[];
  firstUnreadId?: string;
  observedTurns: ObservedTurn[];
  fetchTask: (taskId: string) => Promise<{ task?: YuyiTaskIndex }>;
  messages: YuyiChatMessage[];
  pending: PendingMessage[];
  now: number;
  highlightedMessageId?: string | null;
  peerBusy: boolean | null;
  turnsByReplyTo: Record<string, YuyiTurnProjection>;
  error: string | null;
  onRetry: (text: string) => void;
  onReplyPress: (messageId: string) => void;
  onForwardTurn: (turn: ObservedTurn) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      onScroll={onScroll}
      scrollEventThrottle={120}
      onContentSizeChange={onContentSizeChange}
    >
      <View style={styles.contentColumn}>
        {readOnly ? (
          <ObservedFlow
            turns={observedTurns}
            peerTitle={peerTitle}
            onForward={onForwardTurn}
            fetchTask={fetchTask}
          />
        ) : (
          groups.map((group) => (
            <Fragment key={group.id}>
              {group.messages.some((message) => message.id === firstUnreadId) ? (
                <UnreadDivider />
              ) : null}
              <MessageGroupView
                group={group}
                messages={messages}
                now={now}
                highlightedMessageId={highlightedMessageId}
                peerBusy={peerBusy}
                turnsByReplyTo={turnsByReplyTo}
                onRetry={onRetry}
                onReplyPress={onReplyPress}
              />
            </Fragment>
          ))
        )}
        {pending.map((item) => (
          <PendingBubble key={item.tempId} item={item} now={now} onRetry={onRetry} />
        ))}
        {!readOnly ? (
          <ProcessingPlaceholder
            messages={messages}
            pending={pending}
            now={now}
            peerBusy={peerBusy}
            turnsByReplyTo={turnsByReplyTo}
            peerTitle={peerTitle}
          />
        ) : null}
        {messages.length === 0 && pending.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t("agentChat.emptyConversation")}</Text>
            <Text style={styles.emptyEducation}>{t(emptyEducationKey(readOnly, isLocal))}</Text>
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{t(error)}</Text> : null}
      </View>
    </ScrollView>
  );
}

/** 底部区：旁观只读提示 vs 输入 composer（从 AgentChatScreen 拆出控复杂度） */
export function ChatComposerPane({
  readOnly,
  peerKey,
  peerTitle,
  peerOnline,
  isLocal,
  draft,
  sending,
  inputRef,
  lastReplyText,
  onQuoteReply,
  onClearDraft,
  onGoWorkbench,
  onDraftChange,
  onInputKeyPress,
  onSend,
  onForwardWholeConversation,
}: {
  readOnly: boolean;
  peerKey: string;
  peerTitle: string;
  peerOnline: boolean | null;
  isLocal: boolean;
  draft: string;
  sending: boolean;
  inputRef: { current: EditingTextInputHandle | null };
  lastReplyText?: string;
  onQuoteReply: () => void;
  onClearDraft: () => void;
  onGoWorkbench: () => void | Promise<void>;
  onDraftChange: (text: string) => void;
  onInputKeyPress: (event: InputKeyPressEvent) => void;
  onSend: () => void;
  onForwardWholeConversation: () => void;
}): ReactElement {
  const { t } = useTranslation();
  if (readOnly) {
    return (
      <View style={styles.readOnlyHint}>
        <Text style={styles.readOnlyText}>{t("wechat.readOnlyDetail", { peer: peerTitle })}</Text>
        <ToolbarButton label={t("wechat.forwardIntervene")} onPress={onForwardWholeConversation}>
          <Text style={styles.forwardText}>{t("wechat.forwardIntervene")}</Text>
        </ToolbarButton>
      </View>
    );
  }
  return (
    <View style={styles.composer}>
      <View style={styles.composerInner}>
        <View style={styles.composerActions}>
          {lastReplyText ? (
            <ComposerAction
              testID="wechat-quote-reply-action"
              label={t("wechat.quoteLastReply")}
              onPress={onQuoteReply}
              icon={quoteActionIcon}
            />
          ) : null}
          {draft ? (
            <ComposerAction
              testID="wechat-clear-draft-action"
              label={t("wechat.clearDraft")}
              onPress={onClearDraft}
              icon={clearActionIcon}
            />
          ) : null}
          {isLocal ? (
            <ComposerAction
              testID="wechat-go-workbench-action"
              label={t("wechat.goWorkbench")}
              onPress={onGoWorkbench}
              icon={workbenchActionIcon}
            />
          ) : null}
        </View>
        {peerOnline === false ? (
          <Text style={styles.offlineHint}>{t("composer.offlineHint")}</Text>
        ) : null}
        <View style={styles.composerRow}>
          <EditingTextInput
            key={peerKey}
            ref={inputRef}
            style={styles.input}
            initialValue={draft}
            onChangeText={onDraftChange}
            onKeyPress={onInputKeyPress}
            placeholder={t("composer.placeholder", { peer: peerTitle })}
            multiline
          />
          <ToolbarButton
            label={t("agentChat.send")}
            onPress={onSend}
            disabled={!draft.trim() || sending}
            round
            style={[styles.sendButton, (!draft.trim() || sending) && styles.sendButtonDisabled]}
          >
            <ThemedSend size={18} uniProps={sendIcon} />
          </ToolbarButton>
        </View>
      </View>
    </View>
  );
}

function ComposerAction({
  testID,
  label,
  onPress,
  icon,
}: {
  testID: string;
  label: string;
  onPress: () => void | Promise<void>;
  icon: ReactElement;
}): ReactElement {
  return (
    <PressHighlight
      testID={testID}
      style={styles.composerAction}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon}
      <Text style={styles.composerActionText}>{label}</Text>
    </PressHighlight>
  );
}

// 组内首条/末条判定：早返回纯函数替代嵌套三元
function bubbleGroupPosition(
  index: number,
  isLast: boolean,
  groupSize: number,
): "first" | "middle" | "last" | "single" {
  const isFirst = index === 0;
  if (isFirst && groupSize === 1) return "single";
  if (isFirst) return "first";
  if (isLast) return "last";
  return "middle";
}

function MessageGroupView({
  group,
  messages,
  now,
  highlightedMessageId,
  peerBusy,
  turnsByReplyTo,
  onRetry,
  onReplyPress,
}: {
  group: MessageGroup;
  messages: YuyiChatMessage[];
  now: number;
  highlightedMessageId?: string | null;
  peerBusy: boolean | null;
  turnsByReplyTo: Record<string, YuyiTurnProjection>;
  onRetry: (text: string) => void;
  onReplyPress: (messageId: string) => void;
}): ReactElement {
  return (
    <View style={[styles.messageGroup, group.mine && styles.messageGroupMine]}>
      {!group.mine ? (
        <AgentAvatar kind={group.senderIsOwner ? "owner" : "agent"} size={28} />
      ) : null}
      <View style={styles.messageStack}>
        {!group.mine && group.senderIsOwner ? (
          <Text style={styles.senderNameOwner}>{group.senderName} · Owner</Text>
        ) : null}
        {group.messages.map((message, index) => {
          const last = index === group.messages.length - 1;
          if (message.kind === "system") {
            return (
              <View
                key={message.id}
                style={styles.systemEvent}
                nativeID={`wechat-message-${message.id}`}
              >
                <Text style={styles.systemEventText}>{message.text}</Text>
              </View>
            );
          }
          if (message.dir === "in" && message.from?.role !== "owner") {
            return (
              <View key={message.id} nativeID={`wechat-message-${message.id}`}>
                <ResultCard message={message} messages={messages} onReplyPress={onReplyPress} />
              </View>
            );
          }
          return (
            <Bubble
              key={message.id}
              msg={message}
              now={now}
              onRetry={onRetry}
              hasReply={hasReplyAfter(messages, message)}
              peerBusy={peerBusy}
              turnOutcome={message.hubId ? turnsByReplyTo[message.hubId]?.outcome : undefined}
              highlighted={message.id === highlightedMessageId}
              showMeta={last}
              showTime={last}
              groupPosition={bubbleGroupPosition(index, last, group.messages.length)}
            />
          );
        })}
      </View>
    </View>
  );
}

function ObservedFlow({
  turns,
  peerTitle,
  onForward,
  fetchTask,
}: {
  turns: ObservedTurn[];
  peerTitle: string;
  onForward: (turn: ObservedTurn) => void;
  fetchTask: (taskId: string) => Promise<{ task?: YuyiTaskIndex }>;
}): ReactElement {
  const [left, right] = peerTitle.split("↔").map((name) => name.trim());
  const openTaskSegment = useCallback(
    (rootTaskId: string) => {
      const target = turns
        .flatMap((turn) => turn.messages)
        .find((message) => message.taskId === rootTaskId);
      if (!target) return;
      document
        .getElementById(`wechat-message-${target.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [turns],
  );
  return (
    <>
      {turns.map((turn) => (
        <ObservedTurnCard
          key={`${turn.taskId ?? "unassociated"}:${turn.at}`}
          turn={turn}
          left={left}
          right={right}
          onForward={onForward}
          fetchTask={fetchTask}
          onOpenTaskSegment={openTaskSegment}
        />
      ))}
    </>
  );
}

/** 旁观流单个回合卡：转介入回调在卡内 useCallback 稳定化 */
function ObservedTurnCard({
  turn,
  left,
  right,
  onForward,
  fetchTask,
  onOpenTaskSegment,
}: {
  turn: ObservedTurn;
  left?: string;
  right?: string;
  onForward: (turn: ObservedTurn) => void;
  fetchTask: (taskId: string) => Promise<{ task?: YuyiTaskIndex }>;
  onOpenTaskSegment: (rootTaskId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [segmentsVisible, setSegmentsVisible] = useState(false);
  const [task, setTask] = useState<YuyiTaskIndex | undefined>();
  const [taskError, setTaskError] = useState<string | undefined>();
  const handleForward = useCallback(() => onForward(turn), [onForward, turn]);
  const closeSegments = useCallback(() => setSegmentsVisible(false), []);
  const openSegments = useCallback(() => {
    if (!turn.taskId) return;
    setSegmentsVisible(true);
    setTaskError(undefined);
    void fetchTask(turn.taskId)
      .then((result) => setTask(result.task))
      .catch((error) => setTaskError(String(error)));
  }, [fetchTask, turn.taskId]);
  return (
    <View style={styles.observedTurn}>
      <View style={styles.turnHeader}>
        {turn.taskId ? (
          <ToolbarButton label={t("wechat.taskTurn", { id: turn.taskId })} onPress={openSegments}>
            <Text style={styles.turnTitle}>{t("wechat.taskTurn", { id: turn.taskId })}</Text>
          </ToolbarButton>
        ) : (
          <Text style={styles.turnTitle}>{t("wechat.unassociatedTurn")}</Text>
        )}
        <ToolbarButton label={t("wechat.forward")} onPress={handleForward}>
          <Text style={styles.forwardText}>{t("wechat.forward")}</Text>
        </ToolbarButton>
      </View>
      {turn.messages.map((message) => {
        const sender = message.from?.name ?? message.from?.agentId ?? "Agent";
        const target = sender === left ? (right ?? "Agent") : (left ?? "Agent");
        return (
          <View
            key={message.id}
            style={styles.observedMessage}
            nativeID={`wechat-message-${message.id}`}
          >
            <Text style={styles.directionLabel}>
              {sender} → {target}
            </Text>
            <ResultCard message={message} messages={turn.messages} />
          </View>
        );
      })}
      <TaskSegmentList
        visible={segmentsVisible}
        task={task}
        messages={turn.messages}
        error={taskError}
        onClose={closeSegments}
        onOpenTaskSegment={onOpenTaskSegment}
      />
    </View>
  );
}

function PulseDot({
  delay,
  running = false,
  testID,
}: {
  delay: number;
  running?: boolean;
  testID?: string;
}): ReactElement {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (reducedMotion) return;
    opacity.value = withDelay(
      delay,
      withRepeat(withTiming(running ? 0.45 : 0.3, { duration: 600 }), -1, true),
    );
  }, [delay, opacity, reducedMotion, running]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      testID={testID}
      style={[styles.pulseDot, running && styles.runningPulseDot, style]}
    />
  );
}

function ProcessingPlaceholder({
  messages,
  pending,
  now,
  peerBusy,
  turnsByReplyTo,
  peerTitle,
}: {
  messages: YuyiChatMessage[];
  pending: PendingMessage[];
  now: number;
  peerBusy: boolean | null;
  turnsByReplyTo: Record<string, YuyiTurnProjection>;
  peerTitle: string;
}): ReactElement | null {
  const { t } = useTranslation();
  if (pending.some((item) => !item.failed && !item.delivery)) return null;
  const lastOut = messages.toReversed().find((message) => message.dir === "out");
  if (!lastOut) return null;
  const kind = messageDeliveryState(lastOut, now, {
    hasReply: hasReplyAfter(messages, lastOut),
    peerBusy,
    turnOutcome: lastOut.hubId ? turnsByReplyTo[lastOut.hubId]?.outcome : undefined,
  });
  if (kind !== "injected") return null;
  const seconds = Math.max(0, Math.floor((now - (lastOut.ackAt ?? lastOut.at)) / 1000));
  return (
    <View style={styles.processingCard}>
      <View style={styles.pulseRow}>
        <PulseDot delay={0} />
        <PulseDot delay={200} />
        <PulseDot delay={400} />
      </View>
      <Text style={styles.processingText}>
        {peerTitle} {t("agentChat.msg.processing", { seconds })}
      </Text>
    </View>
  );
}

function UnreadDivider(): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.unreadDivider}>
      <View style={styles.unreadRule} />
      <Text style={styles.unreadText}>{t("wechat.unreadDivider")}</Text>
      <View style={styles.unreadRule} />
    </View>
  );
}

export function NewMessageCapsule({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.capsuleWrap} pointerEvents="box-none">
      <PressHighlight
        testID="wechat-new-message-capsule"
        style={styles.capsule}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t("agentChat.list.newMessages", { count })}
      >
        <Text style={styles.capsuleText}>↓ {t("agentChat.list.newMessages", { count })}</Text>
      </PressHighlight>
    </View>
  );
}

function PendingBubble({
  item,
  now,
  onRetry,
}: {
  item: PendingMessage;
  now: number;
  onRetry: (text: string) => void;
}): ReactElement {
  const msg = useMemo<YuyiChatMessage>(
    () => ({
      id: item.tempId,
      at: item.sentAt,
      ackAt: item.ackAt,
      dir: "out",
      text: item.text,
      ack: pendingAck(item),
    }),
    [item],
  );
  return <Bubble msg={msg} now={now} pendingFailed={item.failed} onRetry={onRetry} />;
}

export function DeliveryGlyph({ kind }: { kind: DeliveryKind }): ReactElement | null {
  const testID = `wechat-delivery-${kind}`;
  switch (kind) {
    case "pending":
      return <ThemedClock testID={testID} size={12} uniProps={mutedIcon} />;
    case "injected":
      return <ThemedClock testID={testID} size={12} uniProps={mutedIcon} />;
    case "mailed":
      return <ThemedMail testID={testID} size={12} uniProps={mutedIcon} />;
    case "noReply":
    case "delivered":
      return <ThemedCheck testID={testID} size={12} uniProps={mutedIcon} />;
    case "failed":
      return <ThemedFailure testID={testID} size={12} uniProps={failIcon} />;
    default:
      return null;
  }
}

function deliveryText(
  kind: DeliveryKind,
  now: number,
  msg: YuyiChatMessage,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  switch (kind) {
    case "pending":
      return t("agentChat.msg.sending");
    case "injected":
      return t("agentChat.msg.processing", {
        seconds: Math.max(0, Math.floor((now - (msg.ackAt ?? msg.at)) / 1000)),
      });
    case "mailed":
      return t("agentChat.msg.mailed");
    case "noReply":
      return t("agentChat.msg.deliveredNoReply");
    case "delivered":
      return t("agentChat.msg.delivered");
    case "failed":
      return t("agentChat.msg.failed");
    default:
      return "";
  }
}

export function Bubble({
  msg,
  now,
  pendingFailed,
  onRetry,
  hasReply,
  peerBusy,
  turnOutcome,
  showMeta = true,
  showTime = true,
  groupPosition = "single",
  highlighted = false,
}: {
  msg: YuyiChatMessage;
  now: number;
  pendingFailed?: boolean;
  onRetry?: (text: string) => void;
  hasReply?: boolean;
  peerBusy?: boolean | null;
  turnOutcome?: YuyiTurnOutcome;
  showMeta?: boolean;
  showTime?: boolean;
  groupPosition?: "first" | "middle" | "last" | "single";
  highlighted?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const mine = msg.dir === "out";
  const delivery = bubbleDelivery(msg, now, pendingFailed, hasReply, peerBusy, turnOutcome);
  const retry = useCallback(() => onRetry?.(msg.text), [msg.text, onRetry]);
  const containerStyle = bubbleContainerStyle(
    mine,
    msg.from?.role === "owner",
    groupPosition,
    highlighted,
  );
  return (
    <View
      nativeID={`wechat-message-${msg.id}`}
      testID={`wechat-bubble-${msg.id}`}
      style={containerStyle}
    >
      <LinkifiedText text={msg.text} style={[styles.bubbleText, mine && styles.bubbleTextMine]} />
      {showMeta && delivery ? (
        <View style={styles.bubbleMeta}>
          <DeliveryGlyph kind={delivery} />
          <Text style={[styles.metaText, delivery === "failed" && styles.metaFail]}>
            {deliveryText(delivery, now, msg, t)}
          </Text>
          {delivery === "failed" ? (
            <ToolbarButton label={t("agentChat.msg.retry")} onPress={retry}>
              <Text style={styles.retryText}>{t("agentChat.msg.retry")}</Text>
            </ToolbarButton>
          ) : null}
        </View>
      ) : null}
      {showTime ? (
        <Text style={styles.metaText}>
          {new Date(msg.at).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}
        </Text>
      ) : null}
    </View>
  );
}

// 气泡容器样式：纯函数承接分组/高亮分支，压低 Bubble 复杂度
function bubbleContainerStyle(
  mine: boolean,
  fromOwner: boolean,
  groupPosition: "first" | "middle" | "last" | "single",
  highlighted: boolean,
) {
  return [
    styles.bubble,
    mine ? styles.bubbleMine : styles.bubbleTheirs,
    !mine && fromOwner && styles.bubbleOwner,
    !mine &&
      (groupPosition === "first" || groupPosition === "single") &&
      styles.bubbleIncomingFirst,
    mine && (groupPosition === "last" || groupPosition === "single") && styles.bubbleOutgoingLast,
    highlighted && styles.bubbleHighlighted,
  ];
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, backgroundColor: theme.colors.surface0 },
  headerRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  headerTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
  },
  observeTag: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.code },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusDotSuccess,
  },
  offlineDot: { backgroundColor: theme.colors.foregroundExtraMuted },
  unknownDot: { backgroundColor: theme.colors.palette.amber[500] },
  onlineText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  busyText: { color: theme.colors.palette.amber[500], fontSize: theme.fontSize.sm },
  activityText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, flexShrink: 1 },
  sessionSwitch: { borderRadius: theme.borderRadius.md },
  sessionSwitchInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
  sessionSwitchText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  sessionSwitchTextSelected: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  menuButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: { xs: theme.spacing[3], md: theme.spacing[6] }, gap: theme.spacing[4] },
  contentColumn: { width: "100%", maxWidth: 780, alignSelf: "center", gap: theme.spacing[4] },
  unreadDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    marginVertical: theme.spacing[6],
  },
  unreadRule: { flex: 1, height: theme.borderWidth[1], backgroundColor: theme.colors.border },
  unreadText: { color: theme.colors.foregroundExtraMuted, fontSize: theme.fontSize.code },
  messageGroup: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[2] },
  messageGroupMine: { justifyContent: "flex-end" },
  messageStack: { maxWidth: { xs: "82%", md: 560 }, gap: theme.spacing[1], flexShrink: 1 },
  senderName: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  senderNameOwner: { color: theme.colors.palette.amber[500] },
  bubble: {
    borderRadius: theme.borderRadius.xl,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    alignSelf: "flex-start",
  },
  bubbleMine: { backgroundColor: theme.colors.accent, alignSelf: "flex-end", maxWidth: "72%" },
  bubbleTheirs: { backgroundColor: theme.colors.surface2 },
  bubbleOwner: {
    backgroundColor: `${theme.colors.palette.amber[500]}${theme.colorScheme === "dark" ? "29" : "1f"}`,
  },
  bubbleIncomingFirst: { borderTopLeftRadius: theme.borderRadius.base },
  bubbleOutgoingLast: { borderBottomRightRadius: theme.borderRadius.base },
  bubbleHighlighted: {
    outlineWidth: theme.borderWidth[1],
    outlineStyle: "solid",
    outlineColor: theme.colors.accent,
  },
  bubbleText: { color: theme.colors.foreground, fontSize: theme.fontSize.content, lineHeight: 22 },
  bubbleTextMine: { color: theme.colors.accentForeground },
  bubbleMeta: {
    flexDirection: "row",
    gap: theme.spacing[1],
    justifyContent: "flex-end",
    alignItems: "center",
    marginTop: 2,
  },
  metaText: { color: theme.colors.foregroundExtraMuted, fontSize: theme.fontSize.code },
  metaFail: { color: theme.colors.statusDanger },
  retryText: { color: theme.colors.statusDanger, fontSize: theme.fontSize.code },
  systemEvent: {
    alignSelf: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface1,
  },
  systemEventText: { color: theme.colors.foregroundExtraMuted, fontSize: theme.fontSize.code },
  observedTurn: { gap: theme.spacing[3], opacity: 0.72 },
  turnHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    paddingBottom: theme.spacing[2],
  },
  turnTitle: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, flex: 1 },
  observedMessage: { gap: theme.spacing[1] },
  directionLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.code },
  forwardText: { color: theme.colors.accentBright, fontSize: theme.fontSize.sm },
  processingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    alignSelf: "flex-start",
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  pulseRow: { flexDirection: "row", gap: theme.spacing[1] },
  pulseDot: {
    width: 4,
    height: 4,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.amber[500],
  },
  runningPulseDot: {
    width: 6,
    height: 6,
    backgroundColor: theme.colors.statusDotRunning,
  },
  processingText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  empty: { alignItems: "center", paddingVertical: theme.spacing[8], gap: theme.spacing[3] },
  emptyTitle: {
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    fontSize: theme.fontSize.base,
  },
  emptyEducation: {
    color: theme.colors.foregroundExtraMuted,
    textAlign: "center",
    fontSize: theme.fontSize.sm,
    maxWidth: 420,
    lineHeight: 20,
  },
  error: { color: theme.colors.statusDanger, textAlign: "center", padding: theme.spacing[2] },
  readOnlyHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  readOnlyText: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  offlineHint: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    marginBottom: theme.spacing[1],
  },
  composer: {
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingVertical: theme.spacing[3],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  composerInner: { width: "100%", maxWidth: 780, alignSelf: "center" },
  composerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  composerAction: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  composerActionText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: theme.spacing[2] },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    borderRadius: theme.borderRadius.xl,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
  },
  sendButton: { width: 36, height: 36, backgroundColor: theme.colors.accent },
  sendButtonDisabled: { opacity: theme.opacity[50] },
  capsuleWrap: {
    position: "absolute",
    bottom: 90,
    alignSelf: "center",
    borderRadius: theme.borderRadius.full,
  },
  capsule: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.accent,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  capsuleText: { color: theme.colors.accentForeground, fontSize: theme.fontSize.code },
}));
