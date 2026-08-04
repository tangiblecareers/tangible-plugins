#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createServer } from './server.js';
const main = async () => {
    const server = createServer(loadConfig());
    await server.connect(new StdioServerTransport());
};
main().catch((err) => {
    // stdout is the MCP transport — diagnostics must go to stderr.
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
