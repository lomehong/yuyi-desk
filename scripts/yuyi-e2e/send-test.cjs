/**
 * Yuyi M1 E2E 发送方（CJS，探针同款结构）。以 claude 身份连 Hub，
 * 上报具名 roster 会话，向 fork daemon（opencode 身份）发 expectReply 消息并等回信。
 *
 * 用法：node send-test.cjs "<消息文本>" [waitMs]
 */
const { HubClient } = require("@qianji/core/hub-client");
const { readFileSync } = require("node:fs");
const { homedir, hostname } = require("node:os");
const { join } = require("node:path");

const text = process.argv[2] || "M1 自环验收：请只回复「M1-OK」三个字符，不要做任何其他事。";
const waitMs = Number(process.argv[3] || 300_000);
const TARGET = "opencode-DESKTOP-8KBIJE2:0b385b15-2e0f-4d62-83a9-9269f8abd44b";
const myName = "sender-probe";
const device = `${hostname()}-e2e-sender`.toLowerCase();

const agentJson = JSON.parse(readFileSync(join(homedir(), ".yuyi", "agent.json"), "utf8"));
const self = agentJson.agents["opencode"];
if (!self || !self.token) {
  console.error("RESULT: NO_IDENTITY");
  process.exit(1);
}

let settled = false;
const timer = setTimeout(() => {
  if (!settled) {
    console.error("RESULT: TIMEOUT");
    process.exit(2);
  }
}, waitMs);

const hub = new HubClient({
  url: agentJson.hub,
  device,
  instanceID: `e2e_${Date.now().toString(36)}`,
  token: self.token,
  agentKind: "e2e-sender",
  capabilities: { wake: "none" },
  onDeliver: async (message) => {
    console.error(`REPLY_FROM=${message.from.name || "?"} replyTo=${message.replyTo || "-"}`);
    console.error(`REPLY_TEXT=${message.text}`);
    settled = true;
    clearTimeout(timer);
    setTimeout(() => process.exit(0), 300);
    return { status: "delivered" };
  },
  log: (m) => console.error(`[hub] ${m}`),
});

hub.start();

const waitConn = setInterval(() => {
  if (!hub.connected) return;
  clearInterval(waitConn);
  console.error(`CONNECTED agentId=${hub.hubAgentId} owner=${hub.hubOwnerUsername || "?"}`);
  hub.updateRoster([{ sessionID: `${myName}:e2e`, name: myName, title: "e2e-sender" }]);
  hub
    .send({
      id: `e2e_${Date.now().toString(36)}`,
      mode: "notify",
      text,
      from: { device, sessionID: `${myName}:e2e`, name: myName },
      to: { target: TARGET },
      time: Date.now(),
      expectReply: true,
    })
    .then((ack) => {
      console.error(`SENT ok=${ack.ok} detail=${ack.detail || "-"}`);
      if (!ack.ok) process.exit(1);
      console.error("WAITING_FOR_REPLY...");
    })
    .catch((e) => {
      console.error(`SEND_ERR=${e.message}`);
      process.exit(1);
    });
}, 200);

setTimeout(() => {
  if (!hub.connected) {
    console.error("RESULT: CONNECT_TIMEOUT");
    process.exit(3);
  }
}, 45_000);
