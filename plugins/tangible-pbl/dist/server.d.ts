import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AuthManager } from './auth.js';
import { type Config, type Env } from './config.js';
import { type HttpClient } from './http.js';
import { SessionStore } from './session/store.js';
export interface Runtime {
    cfg: Config;
    env: Env;
    appUrl: string;
    http: HttpClient;
    auth: AuthManager;
    store: SessionStore;
    activeSessionId?: string;
}
export declare const createRuntime: (cfg: Config, env?: Env) => Runtime;
/**
 * Tokens and business context are environment-scoped, so a switch discards
 * them. Refuses mid-session to stop a staging session advancing a prod course.
 */
export declare const switchEnvironment: (rt: Runtime, env: Env) => Runtime;
export declare const createServer: (cfg: Config) => McpServer;
