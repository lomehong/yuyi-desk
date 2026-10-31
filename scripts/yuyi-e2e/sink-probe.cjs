/**
 * 接收探针：opencode 身份连 Hub，wake:true，具名会话 sink-probe，打印收到的每条消息。
 */
const { HubClient } = require("@qianji/core/hub-client");
const { readFileSync } = require("node:fs");
const { homedir, hostname } = require("node:os");
const { join } = require("node:path");

const agentJson = JSON.parse(readFileSync(join(homedir(), ".yuyi", "agent.json"), "utf8"));
const self = agentJson.agents["opencode"];
const myName = "sink-probe";
const device = `${hostname()}-e2e-sink`.toLowerCase();

const hub = new HubClient({
  url: agentJson.hub,
  device,
  instanceID: `sink_${Date.now().toString(36)}`,
  token: self.token,
  agentKind: "e2e-sink",
  capabilities: { wake: true },
  onDeliver: async (message) => {
    console.error(`SINK_GOT from=${message.from.name || "?"} text=${message.text}`);
    setTimeout(() => process.exit(0), 300);
    return { status: "delivered" };
  },
  log: (m) => console.error(`[hub] ${m}`),
});
hub.start();
setTimeout(() => {
  if (!hub.connected) {
    console.error("SINK_CONNECT_TIMEOUT");
    process.exit(3);
  }
  hub.updateRoster([{ sessionID: `${myName}:sink`, name: myName, title: "e2e-sink" }]);
  console.error("SINK_READY");
}, 8000);
setTimeout(() => {
  console.error("SINK_TIMEOUT");
  process.exit(2);
}, 120_000);
