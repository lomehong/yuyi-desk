import { Redirect } from "expo-router";
import { getStoredTopLevelMode } from "@/stores/wechat-mode-store";
import { useHostRouteServerId } from "@/navigation/host-route-context";
import {
  resolveHostIndexRoute,
  resolveWorkspaceSelectionStatus,
} from "@/navigation/host-runtime-bootstrap";
import { StartupSplashScreen } from "@/screens/startup-splash-screen";
import { useHasHydratedWorkspaces, useWorkspaceExists } from "@/stores/session-store-hooks";
import {
  useIsLastWorkspaceSelectionHydrated,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";

export default function HostIndexRoute() {
  const serverId = useHostRouteServerId();
  const workspaceSelection = useLastWorkspaceSelection();
  const isWorkspaceSelectionLoaded = useIsLastWorkspaceSelectionHydrated();
  const workspaceSelectionWorkspaceId =
    workspaceSelection?.serverId === serverId ? workspaceSelection.workspaceId : null;
  const hasHydratedWorkspaces = useHasHydratedWorkspaces(serverId);
  const workspaceSelectionExists = useWorkspaceExists(serverId, workspaceSelectionWorkspaceId);

  if (!serverId || !isWorkspaceSelectionLoaded) {
    return <StartupSplashScreen />;
  }

  // 顶层模式持久化（「Agent 微信」重构）：上次停留在微信模式则直接回到微信
  if (getStoredTopLevelMode() === "wechat") {
    return <Redirect href={`/h/${serverId}/wechat`} />;
  }

  return (
    <Redirect
      href={resolveHostIndexRoute({
        serverId,
        workspaceSelection,
        workspaceSelectionStatus: resolveWorkspaceSelectionStatus({
          hasHydratedWorkspaces,
          workspaceExists: workspaceSelectionExists,
        }),
      })}
    />
  );
}
