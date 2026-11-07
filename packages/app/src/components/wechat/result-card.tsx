import { useCallback, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Bot, ChevronDown, Copy, Reply } from "lucide-react-native";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import type { YuyiChatMessage } from "@/yuyi/api";
import type { Theme } from "@/styles/theme";

const ThemedBot = withUnistyles(Bot);
const ThemedCopy = withUnistyles(Copy);
const ThemedReply = withUnistyles(Reply);
const ThemedChevron = withUnistyles(ChevronDown);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });
const accentIcon = (theme: Theme) => ({ color: theme.colors.accentBright });

export type ResultBlock =
  | { type: "text"; text: string }
  | { type: "list"; text: string }
  | { type: "code"; language: string; text: string };

interface KeyedResultBlock {
  key: string;
  block: ResultBlock;
}

/** 块内容由消息文本决定且不重排，用「类型+内容+出现序号」做稳定 key */
function keyResultBlocks(blocks: ResultBlock[]): KeyedResultBlock[] {
  const seen = new Map<string, number>();
  return blocks.map((block) => {
    const identity =
      block.type === "code"
        ? `${block.type}:${block.language}:${block.text}`
        : `${block.type}:${block.text}`;
    const occurrence = seen.get(identity) ?? 0;
    seen.set(identity, occurrence + 1);
    return { key: occurrence === 0 ? identity : `${identity}#${occurrence}`, block };
  });
}

export function parseResultBlocks(input: string): ResultBlock[] {
  const blocks: ResultBlock[] = [];
  let current: string[] = [];
  let currentType: "text" | "list" | null = null;
  let code: string[] | null = null;
  let language = "";
  const flush = () => {
    if (currentType && current.length > 0) {
      blocks.push({ type: currentType, text: current.join("\n") });
    }
    current = [];
    currentType = null;
  };
  for (const line of input.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      flush();
      if (code) {
        blocks.push({ type: "code", language, text: code.join("\n") });
        code = null;
        language = "";
      } else {
        code = [];
        language = line.trim().slice(3).trim();
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const type = /^\s*(?:- |\d+\. )/.test(line) ? "list" : "text";
    if (currentType !== type) flush();
    currentType = type;
    current.push(line);
  }
  flush();
  if (code) blocks.push({ type: "code", language, text: code.join("\n") });
  return blocks.filter((block) => block.text.trim().length > 0);
}

export function collapseResultText(input: string): { text: string; collapsed: boolean } {
  const lines = input.split("\n");
  const collapsed = lines.length > 28 || input.length > 1600;
  return {
    text: collapsed ? lines.slice(0, 28).join("\n").slice(0, 1600) : input,
    collapsed,
  };
}

export function replyExcerpt(messages: YuyiChatMessage[], replyTo?: string): string | null {
  if (!replyTo) return null;
  const source = messages.find((message) => message.hubId === replyTo || message.id === replyTo);
  if (!source) return null;
  return source.text.length > 40 ? `${source.text.slice(0, 40)}…` : source.text;
}

export interface ObservedTurn {
  taskId: string | null;
  messages: YuyiChatMessage[];
  at: number;
}

export function groupObservedTurns(messages: YuyiChatMessage[]): ObservedTurn[] {
  const groups: ObservedTurn[] = [];
  for (const message of messages) {
    const previous = groups.at(-1);
    const sameTask = previous?.taskId === (message.taskId ?? null);
    const withinWindow = previous ? message.at - previous.at <= 300_000 : false;
    if (!previous || !sameTask || (!message.taskId && !withinWindow)) {
      groups.push({ taskId: message.taskId ?? null, messages: [message], at: message.at });
    } else {
      previous.messages.push(message);
      previous.at = message.at;
    }
  }
  return groups;
}

export function buildForwardSnapshot(
  peerTitle: string,
  taskId: string | null,
  messages: YuyiChatMessage[],
): string {
  const firstAt = messages[0]?.at ?? Date.now();
  const time = new Date(firstAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const turn = taskId ? `任务回合 ${taskId}` : "未关联任务";
  const lines = messages.map((message) => {
    const sender = message.from?.name ?? message.from?.agentId ?? message.from?.device ?? "Agent";
    return `─ ${sender}：${message.text}`;
  });
  return [`【转自旁观】${peerTitle} · ${turn}（${time}）`, ...lines, "", "（我的介入指令：）"].join(
    "\n",
  );
}

export function ResultCard({
  message,
  messages,
  onReplyPress,
}: {
  message: YuyiChatMessage;
  messages: YuyiChatMessage[];
  onReplyPress?: (messageId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const source = collapseResultText(message.text);
  const blocks = useMemo(
    () =>
      keyResultBlocks(
        parseResultBlocks(expanded || !source.collapsed ? message.text : source.text),
      ),
    [expanded, message.text, source.collapsed, source.text],
  );
  const excerpt = replyExcerpt(messages, message.replyTo);
  const sourceMessage = messages.find(
    (item) => item.hubId === message.replyTo || item.id === message.replyTo,
  );
  const sender = message.from?.name ?? message.from?.agentId ?? message.from?.device ?? "Agent";
  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const copy = useCallback(() => {
    void copyToClipboard(message.text);
  }, [message.text]);
  const openReply = useCallback(() => {
    if (sourceMessage) onReplyPress?.(sourceMessage.id);
  }, [onReplyPress, sourceMessage]);
  const chevronStyle = useMemo(
    () => ({ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }),
    [expanded],
  );

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <ThemedBot size={15} uniProps={accentIcon} />
        <Text style={styles.sender}>{sender}</Text>
        {excerpt ? (
          <PressHighlight style={styles.replyRow} onPress={openReply} accessibilityRole="button">
            <ThemedReply size={12} uniProps={mutedIcon} />
            <Text style={styles.replyText} numberOfLines={1}>
              {t("wechat.replyTo", { text: excerpt })}
            </Text>
          </PressHighlight>
        ) : null}
      </View>
      <View style={styles.body}>
        {blocks.map(({ key, block }) => {
          if (block.type === "code") {
            return (
              <View key={key} style={styles.codePanel}>
                {block.language ? <Text style={styles.codeLanguage}>{block.language}</Text> : null}
                <ScrollView horizontal>
                  <Text style={styles.codeText}>{block.text}</Text>
                </ScrollView>
              </View>
            );
          }
          return (
            <Text key={key} style={[styles.bodyText, block.type === "list" && styles.listText]}>
              {block.text}
            </Text>
          );
        })}
      </View>
      {source.collapsed ? (
        <PressHighlight
          style={styles.expandButton}
          onPress={toggleExpanded}
          accessibilityRole="button"
        >
          <ThemedChevron size={13} uniProps={mutedIcon} style={chevronStyle} />
          <Text style={styles.expandText}>
            {expanded ? t("wechat.collapse") : t("wechat.expand")}
          </Text>
        </PressHighlight>
      ) : null}
      <View style={styles.footer}>
        <Text style={styles.time}>
          {new Date(message.at).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}
        </Text>
        <ToolbarButton label={t("common.actions.copy")} onPress={copy}>
          <ThemedCopy size={14} uniProps={mutedIcon} />
        </ToolbarButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    alignSelf: "stretch",
    maxWidth: "92%",
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  sender: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  replyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flex: 1,
    minWidth: 160,
  },
  replyText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, flex: 1 },
  body: { padding: theme.spacing[3], gap: theme.spacing[2] },
  bodyText: { color: theme.colors.foreground, fontSize: theme.fontSize.content, lineHeight: 22 },
  listText: { paddingLeft: 12 },
  codePanel: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
  },
  codeLanguage: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.code,
    marginBottom: theme.spacing[2],
  },
  codeText: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: 20,
  },
  expandButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
  },
  expandText: { color: theme.colors.accentBright, fontSize: theme.fontSize.sm },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  time: { color: theme.colors.foregroundExtraMuted, fontSize: theme.fontSize.code },
}));
