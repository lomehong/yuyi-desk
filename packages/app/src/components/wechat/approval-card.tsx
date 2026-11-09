import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";
import { EditingTextInput } from "@/components/ui/text-input";
import type { YuyiApproval } from "@/yuyi/api";

// 终态文案：早返回纯函数替代嵌套三元（保持原语义——未知/超时终态回退到“已拒绝”）
function terminalLabel(state: YuyiApproval["state"], t: (key: string) => string): string {
  if (state === "expired") return t("wechat.approvalExpired");
  if (state === "approved") return t("wechat.approvalApproved");
  return t("wechat.approvalDenied");
}

export function ApprovalCard({
  approval,
  onResolve,
  onClose,
}: {
  approval: YuyiApproval;
  onResolve: (
    decision: "approved" | "denied",
    note?: string,
  ) => Promise<{ ok: boolean; detail?: string }>;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [terminal, setTerminal] = useState(approval.state);
  const [error, setError] = useState(approval.error);
  useEffect(() => {
    setTerminal(approval.state);
    setError(approval.error);
  }, [approval.state, approval.error]);
  const pending = terminal === "pending" && approval.expiresAt > Date.now();
  const decide = useCallback(
    async (decision: "approved" | "denied") => {
      if (!pending || sending) return;
      setSending(true);
      setError(undefined);
      try {
        const result = await onResolve(decision, note.trim() || undefined);
        if (result.ok && approval.remote === true) setTerminal(decision);
        else setError(result.detail ?? t("wechat.approvalFailed"));
      } finally {
        setSending(false);
      }
    },
    [approval.remote, note, onResolve, pending, sending, t],
  );
  const approve = useCallback(() => void decide("approved"), [decide]);
  const deny = useCallback(() => void decide("denied"), [decide]);
  const closedLabel = terminalLabel(terminal, t);
  return (
    <View style={styles.card} testID={`wechat-approval-${approval.approvalId}`}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("wechat.approvalTitle")}</Text>
        <PressHighlight accessibilityLabel={t("wechat.closeApproval")} onPress={onClose}>
          <Text style={styles.close}>{t("wechat.closeApproval")}</Text>
        </PressHighlight>
      </View>
      <Text style={styles.summary}>{approval.summary}</Text>
      <Text style={styles.meta}>
        {t("wechat.approvalExpires", { time: new Date(approval.expiresAt).toLocaleString() })}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!pending ? (
        <PressHighlight accessibilityLabel={closedLabel} disabled>
          <Text style={styles.terminal}>{closedLabel}</Text>
        </PressHighlight>
      ) : (
        <>
          <EditingTextInput
            initialValue={note}
            onChangeText={setNote}
            placeholder={t("wechat.approvalNotePlaceholder")}
            style={styles.note}
          />
          <View style={styles.actions}>
            <PressHighlight
              accessibilityLabel={t("wechat.approvalApprove")}
              disabled={sending}
              onPress={approve}
              style={styles.approve}
            >
              <Text style={styles.actionText}>{t("wechat.approvalApprove")}</Text>
            </PressHighlight>
            <PressHighlight
              accessibilityLabel={t("wechat.approvalDeny")}
              disabled={sending}
              onPress={deny}
              style={styles.deny}
            >
              <Text style={styles.actionText}>{t("wechat.approvalDeny")}</Text>
            </PressHighlight>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    margin: 12,
    padding: 16,
    borderRadius: 12,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 10,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: theme.colors.foreground, fontSize: 16, fontWeight: "600" },
  close: { color: theme.colors.foregroundMuted, fontSize: 12 },
  summary: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
  meta: { color: theme.colors.foregroundMuted, fontSize: 12 },
  note: {
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    borderRadius: 8,
    padding: 9,
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  approve: {
    backgroundColor: theme.colors.accent,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  deny: {
    backgroundColor: theme.colors.surface3,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  actionText: { color: theme.colors.foreground, fontWeight: "600" },
  terminal: { color: theme.colors.foregroundMuted, fontWeight: "600" },
  error: { color: theme.colors.destructive, fontSize: 12 },
}));
