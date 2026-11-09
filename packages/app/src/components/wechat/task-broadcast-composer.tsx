import { useCallback, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";
import { EditingTextInput } from "@/components/ui/text-input";
import type { OwnerBroadcastResult } from "@/yuyi/api";

export function TaskBroadcastComposer({
  closed = false,
  onBroadcast,
}: {
  closed?: boolean;
  onBroadcast: (input: { title: string; text: string }) => Promise<OwnerBroadcastResult>;
}): ReactElement {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<OwnerBroadcastResult | null>(null);
  const disabled = closed || sending || !title.trim() || !text.trim();
  const send = useCallback(async () => {
    if (disabled) return;
    setSending(true);
    setResult(null);
    try {
      const ack = await onBroadcast({ title: title.trim(), text: text.trim() });
      setResult(ack);
      if (ack.ok) setText("");
    } finally {
      setSending(false);
    }
  }, [disabled, onBroadcast, text, title]);
  return (
    <View style={styles.composer}>
      <Text style={styles.hint}>{t("wechat.broadcastEveryone")}</Text>
      {closed ? <Text style={styles.closed}>{t("wechat.taskClosed")}</Text> : null}
      <EditingTextInput
        initialValue={title}
        onChangeText={setTitle}
        placeholder={t("wechat.taskTitlePlaceholder")}
        style={styles.titleInput}
      />
      <EditingTextInput
        initialValue={text}
        onChangeText={setText}
        placeholder={t("wechat.broadcastBodyPlaceholder")}
        multiline
        style={styles.bodyInput}
      />
      <PressHighlight
        accessibilityLabel={t("wechat.sendBroadcast")}
        onPress={send}
        disabled={disabled}
        style={[styles.sendButton, disabled && styles.sendDisabled]}
      >
        <Text style={styles.sendText}>
          {sending ? t("agentChat.msg.sending") : t("wechat.sendBroadcast")}
        </Text>
      </PressHighlight>
      {result?.detail ? (
        <Text style={result.ok ? styles.ack : styles.error}>{result.detail}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  composer: { borderTopWidth: 1, borderTopColor: theme.colors.border, padding: 16, gap: 10 },
  hint: { color: theme.colors.foregroundMuted, fontSize: 12 },
  closed: { color: theme.colors.statusWarning, fontSize: 12 },
  titleInput: {
    backgroundColor: theme.colors.surface1,
    borderRadius: 8,
    padding: 10,
    color: theme.colors.foreground,
  },
  bodyInput: {
    backgroundColor: theme.colors.surface1,
    borderRadius: 8,
    padding: 10,
    minHeight: 72,
    color: theme.colors.foreground,
  },
  sendButton: {
    alignSelf: "flex-end",
    backgroundColor: theme.colors.accent,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  sendDisabled: { opacity: 0.45 },
  sendText: { color: theme.colors.accentForeground, fontWeight: "600" },
  ack: { color: theme.colors.statusSuccess, fontSize: 12 },
  error: { color: theme.colors.destructive, fontSize: 12 },
}));
