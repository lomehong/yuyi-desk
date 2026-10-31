/**
 * Yuyi M1 E2E：在 fork daemon 里创建一个 claude provider 的 agent（无初始 prompt，
 * 等待御驿 deliver 注入）。打印 agentId。
 *
 * 用法：node scripts/yuyi-e2e/create-agent.mjs [cwd]
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { createPaseoClient } = require("@getpaseo/client");

const cwd = resolve(process.argv[2] ?? ".paseo-e2e/workspace");
mkdirSync(cwd, { recursive: true });

const client = createPaseoClient({ url: "ws://127.0.0.1:16967/ws" });
await client.connect();
try {
  const agent = await client.agents.create({
    config: { provider: "claude/sonnet" },
    cwd,
  });
  console.log(`AGENT_ID=${agent.id ?? "?"}`);
  console.log("AGENT_CREATED_OK");
} finally {
  await client.close();
}
