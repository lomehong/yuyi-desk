import { useCallback, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";
import type { OwnerBroadcastResult, YuyiChatMessage, YuyiTaskIndex } from "@/yuyi/api";
import { AgentAvatar } from "./agent-avatar";
import { TaskBroadcastComposer } from "./task-broadcast-composer";
import { TaskSegmentList } from "./task-segment-list";

export function TaskConversationView({
  rootTaskId,
  title,
  task,
  messages,
  participantIntent,
  closed = false,
  onBroadcast,
  onOpenMember,
}: {
  rootTaskId: string;
  title: string;
  task: YuyiTaskIndex | undefined;
  messages: YuyiChatMessage[];
  participantIntent?: string[];
  closed?: boolean;
  onBroadcast: (input: { title: string; text: string }) => Promise<OwnerBroadcastResult>;
  onOpenMember: (agentId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [segmentsVisible, setSegmentsVisible] = useState(false);
  const openSegments = useCallback(() => setSegmentsVisible(true), []);
  const closeSegments = useCallback(() => setSegmentsVisible(false), []);
  const openTaskSegment = useCallback(
    (root: string) => {
      const target = messages.find((message) => message.taskId === root);
      if (target)
        document
          .getElementById(`wechat-message-${target.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [messages],
  );
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <AgentAvatar kind="task" />
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{rootTaskId}</Text>
        </View>
        <PressHighlight accessibilityLabel={t("wechat.viewTaskSegments")} onPress={openSegments}>
          <Text style={styles.segmentLink}>{t("wechat.viewTaskSegments")}</Text>
        </PressHighlight>
      </View>
      <View style={styles.members}>
        {(task?.participants ?? participantIntent ?? []).map((agentId) => (
          <MemberChip key={agentId} agentId={agentId} onOpenMember={onOpenMember} />
        ))}
      </View>
      <ScrollView style={styles.messageScroll} contentContainerStyle={styles.messages}>
        {messages.map((message) => (
          <View key={message.id} style={styles.message} nativeID={`wechat-message-${message.id}`}>
            <Text style={styles.messageTask}>{message.taskId ?? rootTaskId}</Text>
            <Text style={styles.messageText}>{message.text}</Text>
          </View>
        ))}
      </ScrollView>
      <TaskBroadcastComposer closed={closed} onBroadcast={onBroadcast} />
      <TaskSegmentList
        visible={segmentsVisible}
        task={task}
        messages={messages}
        onClose={closeSegments}
        onOpenTaskSegment={openTaskSegment}
      />
    </View>
  );
}

// 列表内 per-item 回调提取为子组件（先例：agent-chat-screen 的 PendingBubble 等）
function MemberChip({
  agentId,
  onOpenMember,
}: {
  agentId: string;
  onOpenMember: (agentId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onOpenMember(agentId), [agentId, onOpenMember]);
  return (
    <PressHighlight
      accessibilityLabel={t("wechat.taskMember", { id: agentId })}
      onPress={handlePress}
      style={styles.memberChip}
    >
      <Text style={styles.memberText}>{agentId}</Text>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.foreground, fontSize: 18, fontWeight: "600" },
  subtitle: { color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 2 },
  segmentLink: { color: theme.colors.accentBright, fontSize: 13 },
  members: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  memberChip: {
    backgroundColor: theme.colors.surface1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  memberText: { color: theme.colors.foregroundMuted, fontSize: 12 },
  messageScroll: { flex: 1 },
  messages: { padding: 16, gap: 10 },
  message: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12 },
  messageTask: { color: theme.colors.foregroundExtraMuted, fontSize: 11, marginBottom: 4 },
  messageText: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
}));
