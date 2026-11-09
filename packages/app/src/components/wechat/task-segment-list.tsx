import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { PressHighlight } from "@/components/ui/press-highlight";
import type { SheetHeader } from "@/components/adaptive-modal-sheet";
import type { YuyiChatMessage, YuyiTaskIndex } from "@/yuyi/api";

export function TaskSegmentList({
  visible,
  task,
  messages,
  error,
  onClose,
  onOpenTaskSegment,
}: {
  visible: boolean;
  task: YuyiTaskIndex | undefined;
  messages: YuyiChatMessage[];
  error?: string;
  onClose: () => void;
  onOpenTaskSegment: (rootTaskId: string) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const [selectedTaskId, setSelectedTaskId] = useState(task?.rootTaskId ?? task?.taskId);
  useEffect(() => {
    setSelectedTaskId(task?.rootTaskId ?? task?.taskId);
  }, [task?.rootTaskId, task?.taskId]);
  const selectedMessages = useMemo(
    () => messages.filter((message) => message.taskId === selectedTaskId),
    [messages, selectedTaskId],
  );
  const header = useMemo<SheetHeader>(() => ({ title: t("wechat.taskSegments") }), [t]);
  const rootTaskId = task?.rootTaskId ?? task?.taskId;
  const openRoot = useCallback(() => {
    if (rootTaskId) onOpenTaskSegment(rootTaskId);
  }, [onOpenTaskSegment, rootTaskId]);
  const openTaskLabel = t("wechat.openTask", { id: rootTaskId });
  if (!task && !error) return null;
  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      testID="wechat-task-segments"
      desktopMaxWidth={560}
      desktopHeight={620}
      scrollable={false}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!error && task ? (
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text style={styles.meta}>{task.participants.join(", ")}</Text>
          <PressHighlight
            accessibilityLabel={openTaskLabel}
            onPress={openRoot}
            style={styles.openButton}
          >
            <Text style={styles.openText}>{openTaskLabel}</Text>
          </PressHighlight>
          <View style={styles.segmentRow}>
            {(task.segments ?? []).map((segment) => (
              <TaskSegmentButton
                key={segment.taskId}
                segment={segment}
                selected={selectedTaskId === segment.taskId}
                onSelect={setSelectedTaskId}
              />
            ))}
          </View>
          <View style={styles.messages}>
            {selectedMessages.map((message) => (
              <View
                key={message.id}
                style={styles.message}
                nativeID={`wechat-message-${message.id}`}
              >
                <Text style={styles.messageText}>{message.text}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}
    </AdaptiveModalSheet>
  );
}

function TaskSegmentButton({
  segment,
  selected,
  onSelect,
}: {
  segment: NonNullable<YuyiTaskIndex["segments"]>[number];
  selected: boolean;
  onSelect: (taskId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onSelect(segment.taskId), [onSelect, segment.taskId]);
  return (
    <PressHighlight
      accessibilityLabel={t("wechat.taskSegmentButton", {
        id: segment.taskId,
        count: segment.messageCount,
      })}
      onPress={handlePress}
      style={[styles.segmentButton, selected && styles.segmentSelected]}
    >
      <Text style={styles.segmentTitle}>{segment.taskId}</Text>
      <Text style={styles.segmentMeta}>
        {segment.parentTaskId ? t("wechat.segmentContinuation") : t("wechat.segmentRoot")} ·{" "}
        {segment.messageCount}
      </Text>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  meta: { color: theme.colors.foregroundMuted, fontSize: 12, marginBottom: 12 },
  openButton: { alignSelf: "flex-start", marginBottom: 16, paddingVertical: 6 },
  openText: { color: theme.colors.accentBright, fontSize: 13 },
  segmentRow: { gap: 8 },
  segmentButton: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    padding: 12,
    backgroundColor: theme.colors.surface0,
  },
  segmentSelected: { borderColor: theme.colors.accentBright },
  segmentTitle: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" },
  segmentMeta: { color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 4 },
  messages: { marginTop: 16, gap: 8 },
  message: { backgroundColor: theme.colors.surface1, borderRadius: 8, padding: 10 },
  messageText: { color: theme.colors.foreground, fontSize: 13, lineHeight: 19 },
  error: { color: theme.colors.destructive, padding: 12 },
}));
