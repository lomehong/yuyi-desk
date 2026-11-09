import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MoreHorizontal } from "lucide-react-native";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { YuyiChatEntry } from "@/yuyi/api";
import type { Theme } from "@/styles/theme";

const ThemedMore = withUnistyles(MoreHorizontal);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });

interface ConversationActionClient {
  chats: {
    setChatArchived: (peerKey: string, archived: boolean) => Promise<void>;
    setChatPinned: (peerKey: string, pinned: boolean) => Promise<void>;
    deleteChat: (peerKey: string) => Promise<void>;
  };
}

export function ConversationActions({
  entry,
  client,
  onChanged,
  onDeleted,
}: {
  entry: YuyiChatEntry;
  client: ConversationActionClient;
  onChanged: () => void | Promise<void>;
  onDeleted: (entry: YuyiChatEntry) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const peerKey = entry.peer.key;

  const runChange = useCallback(
    async (action: () => Promise<void>): Promise<boolean> => {
      if (busy) return false;
      setBusy(true);
      setError(null);
      try {
        await action();
        await onChanged();
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, onChanged],
  );

  const togglePinned = useCallback(() => {
    void runChange(() => client.chats.setChatPinned(peerKey, !entry.pinnedAt));
  }, [client.chats, entry.pinnedAt, peerKey, runChange]);

  const toggleArchived = useCallback(() => {
    void runChange(() => client.chats.setChatArchived(peerKey, !entry.archivedAt));
  }, [client.chats, entry.archivedAt, peerKey, runChange]);

  const askDelete = useCallback(() => setConfirmDelete(true), []);
  const cancelDelete = useCallback(() => setConfirmDelete(false), []);

  const remove = useCallback(async () => {
    if (await runChange(() => client.chats.deleteChat(peerKey))) {
      onDeleted(entry);
      setConfirmDelete(false);
    }
  }, [client.chats, entry, onDeleted, peerKey, runChange]);

  const header = useMemo<SheetHeader>(() => ({ title: t("wechat.deleteConversation") }), [t]);
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="outline" onPress={cancelDelete}>
          {t("common.actions.cancel")}
        </Button>
        <Button variant="destructive" disabled={busy} onPress={remove}>
          {t("wechat.deleteLocalOnly")}
        </Button>
      </View>
    ),
    [busy, cancelDelete, remove, t],
  );

  return (
    <View>
      <DropdownMenu compactMode="sheet">
        <DropdownMenuTrigger
          accessibilityRole="button"
          accessibilityLabel={t("wechat.conversationActions")}
        >
          <ThemedMore size={16} uniProps={mutedIcon} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" minWidth={180} sheetTitle={entry.peer.title}>
          <DropdownMenuItem onSelect={togglePinned}>
            {entry.pinnedAt ? t("wechat.unpinConversation") : t("wechat.pinConversation")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={toggleArchived}>
            {entry.archivedAt ? t("wechat.unarchiveConversation") : t("wechat.archiveConversation")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={askDelete}>{t("wechat.deleteConversation")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <Text style={styles.error}>{t("wechat.conversationActionFailed", { error })}</Text>
      ) : null}
      <AdaptiveModalSheet
        header={header}
        visible={confirmDelete}
        onClose={cancelDelete}
        desktopMaxWidth={420}
        testID="wechat-delete-conversation"
        footer={footer}
      >
        <Text style={styles.confirmation}>
          {t("wechat.deleteLocalConfirmation", { title: entry.peer.title })}
        </Text>
        {error ? <Text style={styles.error}>{t("wechat.deleteFailed", { error })}</Text> : null}
      </AdaptiveModalSheet>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  footer: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
  confirmation: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
  },
  error: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
}));
