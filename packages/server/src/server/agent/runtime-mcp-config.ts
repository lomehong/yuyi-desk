import type { AgentSessionConfig, McpServerConfig } from "./agent-sdk-types.js";
import { YUYI_MCP_SERVER_NAME } from "../yuyi/config.js";

export const PASEO_MCP_SERVER_NAME = "paseo";
const PASEO_MCP_PATHNAME = "/mcp/agents";
const YUYI_MCP_PATHNAME = "/mcp/yuyi";

export function stripInternalPaseoMcpServer(config: AgentSessionConfig): AgentSessionConfig {
  const mcpServers = config.mcpServers;
  if (!mcpServers) {
    return config;
  }

  const paseoServer = mcpServers[PASEO_MCP_SERVER_NAME];
  if (!paseoServer || !isInternalPaseoMcpServer(paseoServer)) {
    return config;
  }

  const nextMcpServers = { ...mcpServers };
  delete nextMcpServers[PASEO_MCP_SERVER_NAME];

  const next = { ...config };
  if (Object.keys(nextMcpServers).length > 0) {
    next.mcpServers = nextMcpServers;
  } else {
    delete next.mcpServers;
  }
  return next;
}

export function withRuntimePaseoMcpServer(params: {
  config: AgentSessionConfig;
  agentId: string;
  mcpBaseUrl: string | null;
  /**
   * Capability token authenticating the injected connection to the daemon's
   * Agent MCP endpoint. The daemon password is gated off this route, so without
   * this header the agent's MCP requests are rejected when a password is set.
   */
  mcpAuthToken: string | null;
}): AgentSessionConfig {
  const storedConfig = stripInternalPaseoMcpServer(params.config);
  if (!params.mcpBaseUrl || storedConfig.mcpServers?.[PASEO_MCP_SERVER_NAME]) {
    return storedConfig;
  }

  return {
    ...storedConfig,
    mcpServers: {
      [PASEO_MCP_SERVER_NAME]: {
        type: "http",
        url: `${params.mcpBaseUrl}?callerAgentId=${params.agentId}`,
        ...(params.mcpAuthToken
          ? { headers: { Authorization: `Bearer ${params.mcpAuthToken}` } }
          : {}),
      },
      ...storedConfig.mcpServers,
    },
  };
}

function isInternalPaseoMcpServer(config: McpServerConfig): boolean {
  if (config.type !== "http" && config.type !== "sse") {
    return false;
  }

  try {
    return new URL(config.url).pathname === PASEO_MCP_PATHNAME;
  } catch {
    return false;
  }
}

/**
 * yuyi fork: inject the daemon's Yuyi MCP server (/mcp/yuyi) into agent session
 * configs — same pattern as withRuntimePaseoMcpServer. Skipped when the yuyi
 * link is inactive or the user's own config already declares a "yuyi" server.
 */
export function withRuntimeYuyiMcpServer(params: {
  config: AgentSessionConfig;
  agentId: string;
  yuyiMcpBaseUrl: string | null;
  mcpAuthToken: string | null;
}): AgentSessionConfig {
  if (!params.yuyiMcpBaseUrl) {
    return params.config;
  }
  const mcpServers = params.config.mcpServers;
  if (mcpServers?.[YUYI_MCP_SERVER_NAME] && !isInternalYuyiMcpServer(mcpServers[YUYI_MCP_SERVER_NAME])) {
    return params.config;
  }
  const next = stripInternalYuyiMcpServer(params.config);
  return {
    ...next,
    mcpServers: {
      [YUYI_MCP_SERVER_NAME]: {
        type: "http",
        url: `${params.yuyiMcpBaseUrl}?callerAgentId=${params.agentId}`,
        ...(params.mcpAuthToken
          ? { headers: { Authorization: `Bearer ${params.mcpAuthToken}` } }
          : {}),
      },
      ...next.mcpServers,
    },
  };
}

function stripInternalYuyiMcpServer(config: AgentSessionConfig): AgentSessionConfig {
  const mcpServers = config.mcpServers;
  if (!mcpServers) {
    return config;
  }
  const existing = mcpServers[YUYI_MCP_SERVER_NAME];
  if (!existing || !isInternalYuyiMcpServer(existing)) {
    return config;
  }
  const nextMcpServers = { ...mcpServers };
  delete nextMcpServers[YUYI_MCP_SERVER_NAME];
  const next = { ...config };
  if (Object.keys(nextMcpServers).length > 0) {
    next.mcpServers = nextMcpServers;
  } else {
    delete next.mcpServers;
  }
  return next;
}

function isInternalYuyiMcpServer(config: McpServerConfig): boolean {
  if (config.type !== "http" && config.type !== "sse") {
    return false;
  }
  try {
    return new URL(config.url).pathname === YUYI_MCP_PATHNAME;
  } catch {
    return false;
  }
}
