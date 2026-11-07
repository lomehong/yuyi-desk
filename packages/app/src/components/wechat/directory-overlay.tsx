import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CircleOff, Search, X } from "lucide-react-native";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { EditingTextInput } from "@/components/ui/text-input";
import type { Theme } from "@/styles/theme";
import { AgentAvatar } from "./agent-avatar";
import { moveDirectoryCursor, type DirectoryEntry, type DirectoryGroup } from "./wechat-model";

const ThemedSearch = withUnistyles(Search);
const ThemedX = withUnistyles(X);
const ThemedOffline = withUnistyles(CircleOff);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });

export function DirectoryOverlay({
  visible,
  groups,
  filter,
  onFilterChange,
  onPick,
  onClose,
  titleKey = "wechat.contactAgent",
}: {
  visible: boolean;
  groups: DirectoryGroup[];
  filter: string;
  onFilterChange: (value: string) => void;
  onPick: (entry: DirectoryEntry) => void;
  onClose: () => void;
  titleKey?: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const filteredGroups = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return groups;
    return groups.map((group) => ({
      ...group,
      entries: group.entries.filter((entry) =>
        `${entry.title} ${entry.subtitle} ${entry.device ?? ""} ${entry.activity?.repo ?? ""}`
          .toLowerCase()
          .includes(query),
      ),
    }));
  }, [filter, groups]);

  useEffect(() => {
    setSelectedKey(null);
  }, [filter, visible]);

  const handleKeyPress = useCallback(
    (event: { nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
      const key = event.nativeEvent?.key;
      if (key === "Escape") {
        event.preventDefault?.();
        onClose();
        return;
      }
      if (key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault?.();
        setSelectedKey(
          moveDirectoryCursor(filteredGroups, selectedKey, key === "ArrowDown" ? 1 : -1),
        );
        return;
      }
      if (key === "Enter" && selectedKey) {
        event.preventDefault?.();
        const entry = filteredGroups
          .flatMap((group) => group.entries)
          .find((item) => item.key === selectedKey && !item.disabled);
        if (entry) onPick(entry);
      }
    },
    [filteredGroups, onClose, onPick, selectedKey],
  );

  if (!visible) return null;
  return (
    <View style={styles.overlay} testID="wechat-directory-overlay">
      <PressHighlight
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t("common.actions.close")}
      />
      <View style={styles.center} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{t(titleKey)}</Text>
            <ToolbarButton label={t("common.actions.close")} onPress={onClose}>
              <ThemedX size={16} uniProps={mutedIcon} />
            </ToolbarButton>
          </View>
          <View style={styles.searchBox}>
            <ThemedSearch size={14} uniProps={mutedIcon} />
            <EditingTextInput
              style={styles.searchInput}
              initialValue={filter}
              onChangeText={onFilterChange}
              onKeyPress={handleKeyPress}
              placeholder={t("wechat.directorySearch")}
              autoFocus
            />
          </View>
          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            {filteredGroups.map((group) => (
              <View key={group.id}>
                <Text style={styles.groupTitle}>
                  {t(`wechat.directory.${group.id}`, { count: group.entries.length })}
                </Text>
                {group.entries.map((entry) => (
                  <DirectoryRow
                    key={entry.id}
                    entry={entry}
                    selected={entry.key !== null && entry.key === selectedKey}
                    onPick={onPick}
                  />
                ))}
              </View>
            ))}
            {filteredGroups.every((group) => group.entries.length === 0) ? (
              <Text style={styles.empty}>{t("wechat.directoryEmpty")}</Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

function DirectoryRow({
  entry,
  selected,
  onPick,
}: {
  entry: DirectoryEntry;
  selected: boolean;
  onPick: (entry: DirectoryEntry) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    if (!entry.disabled && entry.key) onPick(entry);
  }, [entry, onPick]);
  const accessibilityState = useMemo(
    () => ({ disabled: entry.disabled, selected }),
    [entry.disabled, selected],
  );
  return (
    <PressHighlight
      style={[styles.row, selected && styles.rowSelected, entry.disabled && styles.rowDisabled]}
      highlightStyle={styles.rowSelected}
      onPress={handlePress}
      disabled={entry.disabled}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={entry.title}
    >
      {entry.disabled ? (
        <View style={styles.avatar}>
          <ThemedOffline size={16} uniProps={mutedIcon} />
        </View>
      ) : (
        <AgentAvatar kind={entry.kind} size={36} busy={entry.activity?.busy} />
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {entry.title}
          {entry.isLocal ? ` · ${t("wechat.localBadge")}` : ""}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {entry.subtitle}
          {entry.activity?.repo ? ` · repo: ${entry.activity.repo}` : ""}
        </Text>
      </View>
      {entry.continued ? <Text style={styles.continued}>{t("wechat.continue")}</Text> : null}
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 60 },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.52)",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing[6] },
  card: {
    width: 420,
    maxWidth: "100%",
    maxHeight: 560,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius["2xl"],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    padding: theme.spacing[4],
    ...theme.shadow.lg,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  searchBox: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface3,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    marginVertical: theme.spacing[3],
  },
  searchInput: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  scroll: { maxHeight: 440 },
  groupTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    paddingVertical: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  rowSelected: { backgroundColor: theme.colors.surfaceSidebarSelected },
  rowDisabled: { opacity: theme.opacity[50] },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface3,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  rowSubtitle: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  continued: { color: theme.colors.accentBright, fontSize: theme.fontSize.code },
  empty: {
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    padding: theme.spacing[6],
    fontSize: theme.fontSize.sm,
  },
}));
