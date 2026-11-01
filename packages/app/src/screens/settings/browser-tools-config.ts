import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";

export const BROWSER_TOOLS_TITLE_KEY = "settings.browserTools.title";
export const BROWSER_TOOLS_WARNING_KEY = "settings.browserTools.warning";
export const BROWSER_TOOLS_UPDATING_KEY = "settings.browserTools.updating";

export interface BrowserToolsCardState {
  isVisible: boolean;
  isEnabled: boolean;
  title: string;
  warning: string;
}

export interface BrowserToolsMutationViewState {
  isSwitchDisabled: boolean;
  loadingText: string | null;
  errorText: string | null;
}

export function getBrowserToolsCardState(input: {
  isConnected: boolean;
  config: MutableDaemonConfig | null;
}): BrowserToolsCardState {
  return {
    isVisible: input.isConnected,
    isEnabled: input.config?.browserTools.enabled === true,
    title: BROWSER_TOOLS_TITLE_KEY,
    warning: BROWSER_TOOLS_WARNING_KEY,
  };
}

export function createBrowserToolsPatch(enabled: boolean): Partial<MutableDaemonConfig> {
  return { browserTools: { enabled } };
}

export function getBrowserToolsMutationViewState(input: {
  isPending: boolean;
  error: unknown;
}): BrowserToolsMutationViewState {
  return {
    isSwitchDisabled: input.isPending,
    loadingText: input.isPending ? BROWSER_TOOLS_UPDATING_KEY : null,
    errorText: input.error ? toErrorMessage(input.error) : null,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
