import { useCallback, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { MenuHeader } from "@/components/headers/menu-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useHosts } from "@/runtime/host-runtime";
import {
  createYuyiClient,
  type YuyiClient,
  type YuyiInbox,
  type YuyiPeersEntry,
  type YuyiStatus,
} from "@/yuyi/api";

type YuyiTab = "status" | "inbox" | "peers";

interface InboxAckState {
  pending: boolean;
  done: boolean;
  detail?: string;
}

export function YuyiScreen(): ReactElement {
  const { t } = useTranslation();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const hosts = useHosts();
  const host = hosts.find((h) => h.serverId === serverId);

  const client = useMemo(() => (host ? createYuyiClient(host) : null), [host]);
  const [tab, setTab] = useState<YuyiTab>("status");
  const [status, setStatus] = useState<YuyiStatus | null>(null);
  const [inbox, setInbox] = useState<YuyiInbox | null>(null);
  const [peers, setPeers] = useState<YuyiPeersEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ackState, setAckState] = useState<Record<string, InboxAckState>>({});

  const refresh = useCallback(
    async (which: YuyiTab | "all" = "all", api?: YuyiClient) => {
      const target = api ?? client;
      if (!target) return;
      setLoading(true);
      setError(null);
      try {
        const wants = which === "all" || which === "status";
        const jobs: Array<Promise<void>> = [];
        if (wants) {
          jobs.push(target.fetchStatus().then(setStatus).catch((e: Error) => setError(e.message)));
        }
        if (which === "all" || which === "inbox") {
          jobs.push(target.fetchInbox().then(setInbox).catch((e: Error) => setError(e.message)));
        }
        if (which === "all" || which === "peers") {
          jobs.push(target.fetchPeers().then(setPeers).catch((e: Error) => setError(e.message)));
        }
        await Promise.all(jobs);
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  // 首次进入拉全量
  if (client && status === null && !loading && error === null) {
    void refresh("all", client);
  }

  const markRead = useCallback(
    async (binding: string, ids: string[]) => {
      if (!client || ids.length === 0) return;
      setAckState((prev) => ({ ...prev, [binding]: { pending: true, done: false } }));
      try {
        const r = await client.ackInbox(binding, ids);
        setAckState((prev) => ({
          ...prev,
          [binding]: { pending: false, done: r.ok, detail: r.detail },
        }));
        await refresh("inbox", client);
      } catch (e) {
        setAckState((prev) => ({
          ...prev,
          [binding]: { pending: false, done: false, detail: String(e) },
        }));
      }
    },
    [client, refresh],
  );

  const tabOptions = [
    { value: "status" as const, label: t("yuyi.tabStatus"), testID: "yuyi-tab-status" },
    { value: "inbox" as const, label: t("yuyi.tabInbox"), testID: "yuyi-tab-inbox" },
    { value: "peers" as const, label: t("yuyi.tabPeers"), testID: "yuyi-tab-peers" },
  ];

  return (
    <View style={styles.container}>
      <MenuHeader title={t("yuyi.title")} />
      <View style={styles.controlRow}>
        <SegmentedControl
          size="sm"
          value={tab}
          onValueChange={(v) => {
            setTab(v);
            if (v === "inbox" && !inbox) void refresh("inbox");
            if (v === "peers" && !peers) void refresh("peers");
          }}
          options={tabOptions}
          testID="yuyi-tabs"
        />
        <Pressable style={styles.refreshButton} onPress={() => void refresh(tab)} testID="yuyi-refresh">
          <Text style={styles.refreshText}>{loading ? "…" : t("yuyi.refresh")}</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!client ? (
        <Text style={styles.empty}>{t("yuyi.errorNoHttp")}</Text>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {tab === "status" ? <StatusView status={status} /> : null}
          {tab === "inbox" ? (
            <InboxView inbox={inbox} ackState={ackState} onMarkRead={markRead} />
          ) : null}
          {tab === "peers" ? <PeersView peers={peers} /> : null}
        </ScrollView>
      )}
    </View>
  );
}

function StatusView({ status }: { status: YuyiStatus | null }): ReactElement {
  const { t } = useTranslation();
  if (!status) {
    return <Text style={styles.empty}>{t("yuyi.errorInactive")}</Text>;
  }
  const rows: Array<[string, string]> = [
    [t("yuyi.connected"), status.connected ? t("yuyi.yes") : t("yuyi.no")],
    [t("yuyi.hub"), status.hub],
    [t("yuyi.device"), status.device],
    [t("yuyi.principal"), status.principal ?? "-"],
  ];
  return (
    <View style={styles.card}>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.kvRow}>
          <Text style={styles.kvKey}>{k}</Text>
          <Text style={styles.kvValue} selectable>
            {v}
          </Text>
        </View>
      ))}
      <Text style={styles.sectionTitle}>{t("yuyi.bindings")}</Text>
      {status.bindings.length === 0 ? (
        <Text style={styles.empty}>-</Text>
      ) : (
        status.bindings.map((b) => (
          <View key={b.paseoAgentId} style={styles.bindingRow}>
            <Text style={styles.kvValue}>{b.name}</Text>
            <Text style={styles.kvKey} numberOfLines={1}>
              {b.title ?? b.paseoAgentId.slice(0, 8)}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

function InboxView({
  inbox,
  ackState,
  onMarkRead,
}: {
  inbox: YuyiInbox | null;
  ackState: Record<string, InboxAckState>;
  onMarkRead: (binding: string, ids: string[]) => void;
}): ReactElement {
  const { t } = useTranslation();
  if (!inbox) {
    return <Text style={styles.empty}>…</Text>;
  }
  const total = inbox.bindings.reduce((n, b) => n + b.entries.length, 0);
  if (total === 0) {
    return <Text style={styles.empty}>{t("yuyi.inboxEmpty")}</Text>;
  }
  return (
    <View>
      {inbox.bindings.map((b) => (
        <View key={b.recipientID} style={styles.card}>
          <View style={styles.bindingHeader}>
            <Text style={styles.sectionTitle}>{b.name}</Text>
            {b.entries.length > 0 ? (
              <Pressable
                style={styles.refreshButton}
                disabled={ackState[b.name]?.pending}
                onPress={() => onMarkRead(b.name, b.entries.map((e) => e.message.id))}
                testID={`yuyi-ack-${b.name}`}
              >
                <Text style={styles.refreshText}>
                  {ackState[b.name]?.pending
                    ? "…"
                    : ackState[b.name]?.done
                      ? t("yuyi.markedRead")
                      : t("yuyi.markAllRead")}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {b.error ? <Text style={styles.error}>{b.error}</Text> : null}
          {b.entries.map((e) => (
            <View key={e.message.id} style={styles.mailRow}>
              <Text style={styles.kvKey}>
                {t("yuyi.from")}: {e.message.from?.name ?? "?"} · {new Date(e.receivedAt).toLocaleString()}
              </Text>
              <Text style={styles.kvValue} selectable>
                {e.message.text}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function PeersView({ peers }: { peers: YuyiPeersEntry[] | null }): ReactElement {
  const { t } = useTranslation();
  if (!peers) {
    return <Text style={styles.empty}>…</Text>;
  }
  if (peers.length === 0) {
    return <Text style={styles.empty}>{t("yuyi.peersEmpty")}</Text>;
  }
  return (
    <View>
      {peers.map((p) => (
        <View key={`${p.device}/${p.agentId ?? ""}`} style={styles.card}>
          <Text style={styles.sectionTitle}>{p.device}</Text>
          {p.role ? <Text style={styles.kvKey}>{p.role}</Text> : null}
          {p.sessions.map((s) => (
            <Text key={s.sessionID} style={styles.kvValue} numberOfLines={1}>
              · {s.name ?? s.sessionID}
              {s.title ? `（${s.title}）` : ""}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    controlRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[3],
      paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
      paddingTop: theme.spacing[3],
      paddingBottom: theme.spacing[2],
    },
    refreshButton: {
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[2],
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.surface0,
    },
    refreshText: {
      color: theme.colors.foreground,
      fontSize: theme.fontSize.sm,
    },
    scroll: {
      flex: 1,
      minHeight: 0,
    },
    scrollContent: {
      flexGrow: 1,
      gap: theme.spacing[3],
      padding: { xs: theme.spacing[3], md: theme.spacing[6] },
    },
    card: {
      gap: theme.spacing[2],
      padding: theme.spacing[4],
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.surface0,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    kvRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: theme.spacing[3],
    },
    kvKey: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
    },
    kvValue: {
      color: theme.colors.foreground,
      fontSize: theme.fontSize.base,
    },
    sectionTitle: {
      color: theme.colors.foreground,
      fontSize: theme.fontSize.base,
      fontWeight: "600",
    },
    bindingRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: theme.spacing[3],
    },
    bindingHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[3],
    },
    mailRow: {
      gap: theme.spacing[1],
      paddingTop: theme.spacing[2],
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    error: {
      color: theme.colors.palette.red[300],
      fontSize: theme.fontSize.sm,
      paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    },
    empty: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.base,
      padding: theme.spacing[4],
      textAlign: "center",
    },
  }));