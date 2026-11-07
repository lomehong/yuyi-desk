import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

export function AgentIdentityBadge({
  role,
  isLocal,
  device,
}: {
  role?: string;
  isLocal?: boolean;
  device?: string;
}): ReactElement | null {
  const { t } = useTranslation();
  if (!role && !isLocal && !device) return null;
  return (
    <View style={styles.row}>
      {role ? <Text style={styles.badge}>{role}</Text> : null}
      {isLocal ? <Text style={[styles.badge, styles.local]}>{t("wechat.localBadge")}</Text> : null}
      {!isLocal && device ? <Text style={styles.device}>{device}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: theme.spacing[1] },
  badge: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.code,
    backgroundColor: theme.colors.surface3,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[1],
  },
  local: {
    color: theme.colors.palette.amber[500],
    backgroundColor: `${theme.colors.palette.amber[500]}29`,
  },
  device: { color: theme.colors.foregroundExtraMuted, fontSize: theme.fontSize.code },
}));
