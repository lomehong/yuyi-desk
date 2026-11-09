import { describe, expect, it } from "vitest";
import { en } from "./resources/en";
import { zhCN } from "./resources/zh-CN";
import { ar } from "./resources/ar";
import { es } from "./resources/es";
import { fr } from "./resources/fr";
import { ja } from "./resources/ja";
import { ko } from "./resources/ko";
import { ptBR } from "./resources/pt-BR";
import { ru } from "./resources/ru";

const requiredKeys = [
  "contactAgent",
  "welcomeHint",
  "conversationActions",
  "pinConversation",
  "unpinConversation",
  "archiveConversation",
  "unarchiveConversation",
  "deleteConversation",
  "deleteLocalOnly",
  "deleteLocalConfirmation",
  "deleteFailed",
  "conversationActionFailed",
  "messageResults",
  "archivedBadge",
  "filter.all",
  "filter.local",
  "filter.archived",
  "directorySearch",
  "directoryEmpty",
  "continue",
  "localBadge",
  "busy",
  "moreActions",
  "copyPeerKey",
  "goWorkbench",
  "forwardIntervene",
  "forwardTitle",
  "forward",
  "replyTo",
  "expand",
  "collapse",
  "mePrefix",
  "conversationResults",
  "agentResults",
  "noSearchResults",
  "collapseSessions",
  "expandSessions",
  "observeEducation",
  "localEducation",
  "remoteEducation",
  "readOnlyDetail",
  "taskTurn",
  "unassociatedTurn",
  "mute",
  "unmute",
  "unreadDivider",
  "switchSession",
  "quoteLastReply",
  "clearDraft",
  "errorConnection",
  "errorUnauthorized",
  "errorTimeout",
  "directory.remote",
  "directory.local",
  "directory.offline",
  "time.now",
  "time.minutes",
  "time.hours",
  "time.yesterday",
  "shortcuts.search",
  "shortcuts.newChat",
  "shortcuts.workbench",
  "shortcuts.wechat",
  "shortcuts.next",
  "shortcuts.prev",
  "shortcuts.escape",
] as const;

function readPath(source: unknown, path: string): unknown {
  return path.split(".").reduce((value, key) => {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  }, source);
}

const locales = { en, zhCN, ar, es, fr, ja, ko, ptBR, ru };

describe("Agent 微信 i18n", () => {
  for (const [locale, resources] of Object.entries(locales)) {
    it(`${locale} has every new Agent 微信 label`, () => {
      const missing = requiredKeys.filter((key) => {
        const value = readPath(resources.wechat, key);
        return typeof value !== "string" || value.length === 0;
      });
      expect(missing).toEqual([]);
    });
  }

  it("uses nested delivery keys instead of returning raw key names", () => {
    expect(zhCN.agentChat.msg.sending).toBe("发送中…");
    expect(en.agentChat.msg.sending).toBe("Sending…");
    expect(zhCN.agentChat.list.newMessages).toContain("新消息");
  });
});
