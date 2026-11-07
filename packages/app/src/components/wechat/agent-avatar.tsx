import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Bot, Eye, Users } from "lucide-react-native";
import type { Theme } from "@/styles/theme";

const ThemedBot = withUnistyles(Bot);
const ThemedEye = withUnistyles(Eye);
const ThemedUsers = withUnistyles(Users);
const accentIcon = (theme: Theme) => ({ color: theme.colors.accentBright });
const amberIcon = (theme: Theme) => ({ color: theme.colors.palette.amber[500] });
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });

function AvatarGlyph({
  kind,
  iconSize,
}: {
  kind: "owner" | "agent" | "observe";
  iconSize: number;
}): ReactElement {
  if (kind === "owner") return <ThemedUsers size={iconSize} uniProps={amberIcon} />;
  if (kind === "observe") return <ThemedEye size={iconSize} uniProps={mutedIcon} />;
  return <ThemedBot size={iconSize} uniProps={accentIcon} />;
}

export function AgentAvatar({
  kind,
  size = 36,
  busy = false,
}: {
  kind: "owner" | "agent" | "observe";
  size?: 28 | 36;
  busy?: boolean;
}): ReactElement {
  const iconSize = size === 28 ? 14 : 16;
  return (
    <View style={[styles.avatar, size === 28 && styles.small, styles[kind]]}>
      <AvatarGlyph kind={kind} iconSize={iconSize} />
      {busy ? <View style={styles.busyDot} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  avatar: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  small: { width: 28, height: 28 },
  agent: { backgroundColor: `${theme.colors.accent}${theme.colorScheme === "dark" ? "29" : "1f"}` },
  owner: {
    backgroundColor: `${theme.colors.palette.amber[500]}${theme.colorScheme === "dark" ? "29" : "1f"}`,
  },
  observe: { backgroundColor: theme.colors.surface3 },
  busyDot: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.amber[500],
  },
}));
