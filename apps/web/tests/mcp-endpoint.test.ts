import { describe, expect, it } from "vitest";
import { MCP_BASE_PATH, MCP_CONNECTION_PATH } from "@/lib/mcp/endpoint";

describe("MCP connection endpoint", () => {
  it("pins the streamable HTTP URL derived by mcp-handler", () => {
    expect(MCP_BASE_PATH).toBe("/api/mcp");
    expect(MCP_CONNECTION_PATH).toBe("/api/mcp/mcp");
    expect(`${MCP_BASE_PATH}/mcp`).toBe(MCP_CONNECTION_PATH);
  });
});
