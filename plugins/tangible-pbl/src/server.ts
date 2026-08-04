import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AuthManager } from './auth.js';
import { configFor, type Config, type Env } from './config.js';
import { createHttpClient, type HttpClient } from './http.js';
import { SessionStore } from './session/store.js';
import { registerContextTools } from './tools/context.js';
import { registerSessionTools } from './tools/session.js';
import { registerDirectTools } from './tools/direct.js';

export interface Runtime {
  cfg: Config;
  env: Env;
  apiUrl: string;
  appUrl: string;
  http: HttpClient;
  auth: AuthManager;
  store: SessionStore;
  activeSessionId?: string;
}

export const createRuntime = (cfg: Config, env: Env = cfg.active): Runtime => {
  const ec = configFor(cfg, env);
  const http = createHttpClient(ec.apiUrl);
  return {
    cfg,
    env,
    apiUrl: ec.apiUrl,
    appUrl: ec.appUrl,
    http,
    auth: new AuthManager(http, { email: ec.email, password: ec.password }),
    store: new SessionStore(),
  };
};

/**
 * Tokens and business context are environment-scoped, so a switch discards
 * them. Refuses mid-session to stop a staging session advancing a prod course.
 */
export const switchEnvironment = (rt: Runtime, env: Env): Runtime => {
  if (rt.activeSessionId) {
    throw new Error(
      `Cannot switch environment while session ${rt.activeSessionId} is open. ` +
        `Call pbl_abort first.`,
    );
  }
  if (env === rt.env) return rt;
  rt.auth.reset();
  return { ...createRuntime(rt.cfg, env), store: rt.store };
};

export const createServer = (cfg: Config): McpServer => {
  const server = new McpServer({ name: 'pbl-mcp', version: '0.1.0' });
  const holder = { current: createRuntime(cfg) };
  registerContextTools(server, holder);
  registerSessionTools(server, holder);
  registerDirectTools(server, holder);
  return server;
};
