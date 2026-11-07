import { useMemo, useState, type ReactElement } from "react";
import type { YuyiChatEntry, YuyiPeersEntry, YuyiStatus } from "@/yuyi/api";
import { DirectoryOverlay } from "./directory-overlay";
import { buildDirectoryGroups, type DirectoryEntry } from "./wechat-model";

export function ForwardSheet({
  visible,
  conversations,
  peers,
  status,
  onSelect,
  onClose,
}: {
  visible: boolean;
  conversations: YuyiChatEntry[];
  peers: YuyiPeersEntry[] | null;
  status: YuyiStatus | null;
  onSelect: (entry: DirectoryEntry) => void;
  onClose: () => void;
}): ReactElement {
  const [filter, setFilter] = useState("");
  const groups = useMemo(
    () =>
      buildDirectoryGroups(
        peers,
        status,
        conversations.filter((entry) => entry.peer.kind !== "observe"),
      ),
    [conversations, peers, status],
  );
  return (
    <DirectoryOverlay
      visible={visible}
      groups={groups}
      filter={filter}
      onFilterChange={setFilter}
      onPick={onSelect}
      onClose={onClose}
      titleKey="wechat.forwardTitle"
    />
  );
}
