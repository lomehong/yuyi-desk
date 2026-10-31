/**
 * Yuyi MCP 出站验证：以 MCP 客户端连 daemon 的 /mcp/yuyi，
 * 列工具 → yuyi_status → yuyi_send（发给 sink-probe 接收探针）。
 *
 * 用法：node mcp-call-test.cjs [callerAgentId]
 */
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const callerAgentId = process.argv[2] || "a2a727a7-cb77-416f-a082-5730443d4744";
const url = new URL(`http://127.0.0.1:16967/mcp/yuyi?callerAgentId=${callerAgentId}`);

(async () => {
  const client = new Client({ name: "yuyi-mcp-e2e", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(url);
  await client.connect(transport);
  console.error("MCP_CONNECTED");

  const tools = await client.listTools();
  console.error("TOOLS=" + tools.tools.map((t) => t.name).join(","));

  const status = await client.callTool({ name: "yuyi_status", arguments: {} });
  console.error("STATUS=" + JSON.stringify(status.content).slice(0, 300));

  const sent = await client.callTool({
    name: "yuyi_send",
    arguments: { to: "sink-probe", message: "M1 尾巴出站验证：来自 yuyi MCP 工具的消息" },
  });
  console.error("SEND_RESULT=" + JSON.stringify(sent.content));

  await client.close();
  process.exit(0);
})().catch((e) => {
  console.error("ERR=" + e.message);
  process.exit(1);
});
