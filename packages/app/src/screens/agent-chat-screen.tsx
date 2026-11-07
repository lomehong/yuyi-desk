/**
 * 「Agent 微信」M1 · 会话页（Owner 直发身份）。
 *
 * 消息流 + 输入框：发信身份固定=「我」（Owner 本人，经 daemon Owner 通道）；
 * 入向气泡按 from.role 渲染（owner=对方本人最高优先级样式 / agent=普通）。
 * 打开即清未读；15s 轮询合并新消息（daemon 侧已把 inbox 归组进会话）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { BadgeCheck, Bot, RefreshCw, Send } from "lucide-react-native";

import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { useHosts } from "@/runtime/host-runtime";
import { createYuyiClient, type YuyiChatMessage } from "@/yuyi/api";
import type { Theme } from "@/styles/theme";

/** 主题色图标（docs/unistyles.md 方案 3）：module scope 包装一次 + 常量映射 */
const ThemedBadgeCheck = withUnistyles(BadgeCheck);
const ThemedBot = withUnistyles(Bot);
const ThemedRefreshCw = withUnistyles(RefreshCw);
const ThemedSend = withUnistyles(Send);

const AMBER_ICON = (theme: Theme) => ({ color: theme.colors.palette.amber[500] });
const MUTED_ICON = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });
const SEND_ICON = (theme: Theme) => ({ color: theme.colors.surface0 });

function fmtTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function AgentChatScreen(): ReactElement {
  const { t } = useTranslation();
  const router = useRouter();
  const { serverId, peerKey, title, kind } = useLocalSearchParams<{
    serverId: string;
    peerKey: string;
    title?: string;
    kind?: string;
  }>();
  const hosts = useHosts();
  const host = hosts.find((h) => h.serverId === serverId);
  const client = useMemo(() => (host ? createYuyiClient(host) : null), [host]);

  const [messages, setMessages] = useState<YuyiChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<EditingTextInputHandle>(null);

  const peerTitle = title ?? peerKey;
  const peerKind: "owner" | "agent" = kind === "owner" ? "owner" : "agent";

  const refresh = useCallback(async () => {
    if (!client || !peerKey) return;
    try {
      const r = await client.chats.fetchChatHistory(peerKey);
      setMessages(r.messages);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [client, peerKey]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const goBack = useCallback(() => {
    router.back();
  }, [router]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || sending || !client || !peerKey) return;
    setSending(true);
    void client.chats
      .sendChat(peerKey, text)
      .then(() => {
        setDraft("");
        inputRef.current?.replaceText("");
        return refresh();
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setSending(false));
  }, [client, draft, peerKey, refresh, sending]);

  const canSend = Boolean(draft.trim()) && !sending;

  const scrollToEnd = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <ToolbarButton label={t("common.actions.back")} onPress={goBack}>
          <Text style={styles.backGlyph}>←</Text>
        </ToolbarButton>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {peerTitle}
          {peerKind === "owner" ? <Text style={styles.ownerTag}> · Owner</Text> : null}
        </Text>
        <ToolbarButton label={t("yuyi.refresh")} onPress={refresh}>
          <ThemedRefreshCw size={15} uniProps={MUTED_ICON} />
        </ToolbarButton>
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onContentSizeChange={scrollToEnd}
      >
        {messages.map((m) => (
          <Bubble key={m.id} msg={m} />
        ))}
        {messages.length === 0 ? (
          <Text style={styles.empty}>{t("agentChat.emptyConversation")}</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <View style={styles.composer}>
        <EditingTextInput
          ref={inputRef}
          style={styles.input}
          initialValue=""
          onChangeText={setDraft}
          placeholder={t("agentChat.inputPlaceholder")}
          multiline
        />
        <ToolbarButton label={t("agentChat.send")} onPress={send} disabled={!canSend} round>
          <ThemedSend size={18} uniProps={SEND_ICON} />
        </ToolbarButton>
      </View>
    </View>
  );
}

function Bubble({ msg }: { msg: YuyiChatMessage }): ReactElement {
  const mine = msg.dir === "out";
  const senderIsOwner = msg.from?.role === "owner";
  const senderName = mine
    ? undefined
    : msg.from?.ownerUsername || msg.from?.name || msg.from?.device || "…";
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      {!mine ? (
        <View style={styles.senderRow}>
          {senderIsOwner ? (
            <ThemedBadgeCheck size={13} uniProps={AMBER_ICON} />
          ) : (
            <ThemedBot size={13} uniProps={MUTED_ICON} />
          )}
          <Text style={[styles.senderName, senderIsOwner && styles.senderNameOwner]}>
            {senderName}
          </Text>
          {senderIsOwner ? <Text style={styles.ownerBadge}>{": Owner"}</Text> : null}
        </View>
      ) : null}
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <Text style={styles.bubbleText}>{msg.text}</Text>
        <View style={styles.bubbleMeta}>
          {mine && msg.ack ? (
            <Text style={[styles.metaText, !msg.ack.ok && styles.metaFail]}>
              {msg.ack.ok ? "✓" : "✗"}
            </Text>
          ) : null}
          <Text style={styles.metaText}>{fmtTime(msg.at)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, backgroundColor: theme.colors.surface0 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    height: 44,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
  },
  ownerTag: { color: theme.colors.palette.amber[500], fontSize: 12 },
  backGlyph: { color: theme.colors.foreground, fontSize: 18, lineHeight: 22 },
  scroll: { flex: 1 },
  scrollContent: { padding: theme.spacing[3], gap: theme.spacing[2] },
  empty: {
    color: theme.colors.foregroundExtraMuted,
    textAlign: "center",
    paddingVertical: theme.spacing[8],
  },
  error: { color: theme.colors.palette.red[500], textAlign: "center", padding: theme.spacing[2] },
  bubbleRow: { flexDirection: "row", justifyContent: "flex-end", maxWidth: "100%" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubbleRowTheirs: { justifyContent: "flex-start" },
  senderRow: {
    position: "absolute",
    top: -16,
    left: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  senderName: { color: theme.colors.foregroundExtraMuted, fontSize: 11 },
  senderNameOwner: { color: theme.colors.palette.amber[500], fontWeight: theme.fontWeight.medium },
  ownerBadge: { color: theme.colors.palette.amber[500], fontSize: 10 },
  bubble: {
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    marginTop: theme.spacing[2],
    maxWidth: "78%",
  },
  bubbleMine: { backgroundColor: theme.colors.accent },
  bubbleTheirs: { backgroundColor: theme.colors.surface2 },
  bubbleText: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  bubbleMeta: { flexDirection: "row", gap: 6, justifyContent: "flex-end", marginTop: 2 },
  metaText: { color: theme.colors.foregroundExtraMuted, fontSize: 10 },
  metaFail: { color: theme.colors.palette.red[500] },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
  },
}));
