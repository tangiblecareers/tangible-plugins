import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Runtime } from '../server.js';
export declare const registerSessionTools: (server: McpServer, rt: {
    current: Runtime;
}) => void;
