import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CircleOff, Search } from "lucide-react-native";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { PressHighlight } from "@/components/ui/press-highlight";
import { EditingTextInput } from "@/components/ui/text-input";
import type { Theme } from "@/styles/theme";
import { AgentAvatar } from "./agent-avatar";
import { moveDirectoryCursor, type DirectoryEntry, type DirectoryGroup } from "./wechat-model";

const ThemedSearch = withUnistyles(Search);
const ThemedOffline = withUnistyles(CircleOff);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });

export function DirectoryOverlay({
  visible,
  groups,
  filter,
  onFilterChange,
  onPick,
  onClose,
  onCreateTask,
  titleKey = "wechat.contactAgent",
}: {
  visible: boolean;
  groups: DirectoryGroup[];
  filter: string;
  onFilterChange: (value: string) => void;
  onPick: (entry: DirectoryEntry) => void;
  onClose: () => void;
  onCreateTask?: (entries: DirectoryEntry[]) => void;
  titleKey?: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [multiMode, setMultiMode] = useState(false);
  const [intentKeys, setIntentKeys] = useState<Set<string>>(new Set());
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
    setMultiMode(false);
    setIntentKeys(new Set());
  }, [filter, visible]);

  const pickEntry = useCallback(
    (entry: DirectoryEntry) => {
      if (!multiMode) {
        onPick(entry);
        return;
      }
      if (!entry.key) return;
      setIntentKeys((current) => {
        const next = new Set(current);
        if (next.has(entry.key!)) next.delete(entry.key!);
        else next.add(entry.key!);
        return next;
      });
    },
    [multiMode, onPick],
  );

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
        if (entry) pickEntry(entry);
      }
    },
    [filteredGroups, onClose, pickEntry, selectedKey],
  );

  const header = useMemo<SheetHeader>(() => ({ title: t(titleKey) }), [t, titleKey]);
  const toggleMultiMode = useCallback(() => setMultiMode((value) => !value), []);
  const createBroadcastTask = useCallback(() => {
    if (!onCreateTask) return;
    onCreateTask(
      filteredGroups
        .flatMap((group) => group.entries)
        .filter((entry) => entry.key && intentKeys.has(entry.key)),
    );
  }, [filteredGroups, intentKeys, onCreateTask]);
  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      testID="wechat-directory-overlay"
      desktopMaxWidth={420}
      desktopHeight={560}
      scrollable={false}
      contentStyle={styles.content}
    >
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
      {onCreateTask ? (
        <View style={styles.multiBar}>
          <PressHighlight
            accessibilityLabel={t("wechat.multiSelectAgents")}
            onPress={toggleMultiMode}
          >
            <Text style={styles.multiText}>{t("wechat.multiSelectAgents")}</Text>
          </PressHighlight>
          {multiMode ? <Text style={styles.hint}>{t("wechat.broadcastEveryone")}</Text> : null}
          {multiMode ? (
            <PressHighlight
              accessibilityLabel={t("wechat.createTaskBroadcast")}
              disabled={intentKeys.size === 0}
              onPress={createBroadcastTask}
            >
              <Text style={styles.multiText}>{t("wechat.createTaskBroadcast")}</Text>
            </PressHighlight>
          ) : null}
        </View>
      ) : null}
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
                online={group.id !== "offline"}
                selected={
                  multiMode
                    ? Boolean(entry.key && intentKeys.has(entry.key))
                    : entry.key !== null && entry.key === selectedKey
                }
                onPick={pickEntry}
              />
            ))}
          </View>
        ))}
        {filteredGroups.every((group) => group.entries.length === 0) ? (
          <Text style={styles.empty}>{t("wechat.directoryEmpty")}</Text>
        ) : null}
      </ScrollView>
    </AdaptiveModalSheet>
  );
}

function DirectoryRow({
  entry,
  online,
  selected,
  onPick,
}: {
  entry: DirectoryEntry;
  online: boolean;
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
      {online ? (
        <View
          style={styles.onlineDot}
          accessibilityRole="image"
          accessibilityLabel={t("agentChat.peer.online")}
        />
      ) : null}
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { paddingHorizontal: theme.spacing[4], paddingBottom: theme.spacing[4] },
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
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusDotSuccess,
  },
  multiBar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    marginBottom: theme.spacing[2],
  },
  multiText: { color: theme.colors.accentBright, fontSize: theme.fontSize.sm },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.code },
  empty: {
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    padding: theme.spacing[6],
    fontSize: theme.fontSize.sm,
  },
}));
