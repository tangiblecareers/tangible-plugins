import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listBusinesses, resolveBusiness } from '../resolve.js';
import { switchEnvironment, type Runtime } from '../server.js';
import { text, banner } from './render.js';

export const registerContextTools = (
  server: McpServer,
  rt: { current: Runtime },
): void => {
  server.tool(
    'pbl_whoami',
    'Show the active Tangible environment, business and role.',
    {},
    async () => {
      const current = rt.current;
      const ctx = current.auth.context();
      return text(
        [
          `Environment: ${banner(current)}`,
          ctx
            ? `Business: ${ctx.businessName} (${ctx.businessRole})`
            : 'Business: none selected — call pbl_use_business',
        ].join('\n'),
      );
    },
  );

  server.tool(
    'pbl_list_businesses',
    'List the businesses this account can author courses for.',
    {},
    async () => {
      const current = rt.current;
      const list = await listBusinesses(current.http, current.auth);
      return text(
        list.length === 0
          ? 'This account belongs to no businesses.'
          : [`${banner(current)}`, ...list.map((b) => `- ${b.name}`)].join('\n'),
      );
    },
  );

  server.tool(
    'pbl_use_business',
    'Log in to a business by name. This is gate 1 — it confirms which company you are authoring into.',
    { name: z.string().describe('Business name, or a unique prefix of it') },
    async ({ name }) => {
      const current = rt.current;
      const biz = await resolveBusiness(current.http, current.auth, name);
      const ctx = await current.auth.loginBusiness(biz.id, biz.name);
      return text(
        `${banner(current)}\nNow authoring as ${ctx.businessRole} in ${ctx.businessName}.`,
      );
    },
  );

  server.tool(
    'pbl_use_environment',
    'Switch between staging and production. Clears the login; refuses while a session is open.',
    { env: z.enum(['staging', 'production']) },
    async ({ env }) => {
      // Deliberate exception to the snapshot pattern: this handler's whole
      // purpose is to mutate rt.current, so it must read/write it directly.
      rt.current = switchEnvironment(rt.current, env);
      return text(
        `${banner(rt.current)}\nSwitched to ${env}. Call pbl_use_business to log in again.`,
      );
    },
  );
};
