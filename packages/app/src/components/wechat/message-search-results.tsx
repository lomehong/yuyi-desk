import { useCallback, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";
import type { WeChatMessageSearchResult } from "@/stores/wechat-search-store";
import { AgentAvatar } from "./agent-avatar";

export function MessageSearchResults({
  results,
  serverId,
  onOpen,
}: {
  results: WeChatMessageSearchResult[];
  serverId: string;
  onOpen: (target: { serverId: string; peerKey: string; messageId: string }) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View>
      <Text style={styles.title}>{t("wechat.messageResults", { count: results.length })}</Text>
      {results.map((result) => (
        <MessageResultRow
          key={`${serverId}:${result.peer.key}:${result.message.id}`}
          result={result}
          serverId={serverId}
          onOpen={onOpen}
        />
      ))}
    </View>
  );
}

function MessageResultRow({
  result,
  serverId,
  onOpen,
}: {
  result: WeChatMessageSearchResult;
  serverId: string;
  onOpen: (target: { serverId: string; peerKey: string; messageId: string }) => void;
}): ReactElement {
  const { t } = useTranslation();
  const open = useCallback(
    () =>
      onOpen({
        serverId,
        peerKey: result.peer.key,
        messageId: result.message.id,
      }),
    [onOpen, result.message.id, result.peer.key, serverId],
  );
  return (
    <PressHighlight
      style={styles.row}
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={result.summary}
    >
      <AgentAvatar kind={result.peer.kind === "owner" ? "owner" : "agent"} size={28} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {result.peer.title}
        </Text>
        <Text style={styles.summary} numberOfLines={2}>
          {result.summary}
        </Text>
      </View>
      {result.archived ? <Text style={styles.archived}>{t("wechat.archivedBadge")}</Text> : null}
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    marginHorizontal: theme.spacing[2],
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  text: { flex: 1, minWidth: 0 },
  name: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  summary: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  archived: { color: theme.colors.foregroundExtraMuted, fontSize: theme.fontSize.code },
}));
