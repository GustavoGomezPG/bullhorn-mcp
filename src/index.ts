#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { collectTools } from "./tools/register.js";
import { BullhornError } from "./bullhorn/client.js";

async function main() {
  const config = loadConfig();
  const server = new McpServer({ name: "bullhorn-mcp", version: "0.1.0" });
  for (const tool of collectTools(config)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema as any },
      async (args: unknown) => {
        try {
          return await tool.handler(args ?? {});
        } catch (e) {
          const message = e instanceof BullhornError ? `[${e.code}] ${e.message}` : `Unexpected error: ${(e as Error).message}`;
          return { content: [{ type: "text" as const, text: message }], isError: true };
        }
      },
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`bullhorn-mcp connected for vanity "${config.vanity}".`);
}

main().catch((e) => { console.error(`bullhorn-mcp failed to start: ${(e as Error).message}`); process.exit(1); });
