/**
 * Yuyi M1 E2E 发送方：以 codex 身份（~/.yuyi/agent.json 读取，不硬编码）连 Hub，
 * 上报具名 roster 会话，向 fork daemon（opencode 身份）发 expectReply 消息，
 * 等待自动回信，最长 waitMs。
 *
 * 用法：node scripts/yuyi-e2e/send-test.mjs "<消息文本>" [waitMs]
 */
import { readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { HubClient } = require("@qianji/core/hub-client");

const text = process.argv[2] ?? "M1 自环验收：请只回复「M1-OK」两个字，不要做任何其他事。";
const waitMs = Number(process.argv[3] ?? 300_000);
const TARGET = "opencode-DESKTOP-8KBIJE2";

// 从 ~/.yuyi/agent.json 取 codex 身份（运行时读取，避免机密入库）
const agentJson = JSON.parse(readFileSync(join(homedir(), ".yuyi", "agent.json"), "utf8"));
const hubUrl = agentJson.hub;
const self = agentJson.agents["claude"];
if (!self?.token) throw new Error("agent.json 缺少 codex 身份");
const myName = "claude-probe-e2e";
const device = `${hostname()}-e2e-sender`.toLowerCase();

let settled = false;
const timer = setTimeout(() => {
  if (!settled) {
    console.error("RESULT: TIMEOUT（未在期限内收到回信）");
    process.exit(2);
  }
}, waitMs);

const hub = new HubClient({
  url: hubUrl,
  device,
  instanceID: `e2e_${Date.now().toString(36)}`,
  token: self.token,
  agentKind: "e2e-sender",
  capabilities: { wake: "none" },
  onDeliver: async (message) => {
    console.error(`REPLY_FROM=${message.from.name ?? "?"} replyTo=${message.replyTo ?? "-"}`);
    console.error(`REPLY_TEXT=${message.text}`);
    settled = true;
    clearTimeout(timer);
    setTimeout(() => process.exit(0), 200);
    return { status: "delivered" };
  },
  log: (m) => console.error(`[hub] ${m}`),
});

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("connect timeout")), 45_000);
  const poll = setInterval(() => {
    if (hub.connected) {
      clearTimeout(t);
      clearInterval(poll);
      resolve();
    }
  }, 200);
});

console.error(`CONNECTED agentId=${hub.hubAgentId} owner=${hub.hubOwnerUsername ?? "?"}`);
// 具名会话：让回信 notify 能按名路由回本连接
hub.updateRoster([{ sessionID: `${myName}:e2e`, name: myName, title: "e2e-sender" }]);

const ack = await hub.send({
  id: `e2e_${Date.now().toString(36)}`,
  mode: "notify",
  text,
  from: { device, sessionID: `${myName}:e2e`, name: myName },
  to: { target: TARGET },
  time: Date.now(),
  expectReply: true,
});
console.error(`SENT ok=${ack.ok} detail=${ack.detail ?? "-"}`);
if (!ack.ok) process.exit(1);
console.error("WAITING_FOR_REPLY...");
