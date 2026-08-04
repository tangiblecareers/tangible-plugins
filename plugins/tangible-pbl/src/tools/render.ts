import type { Runtime } from '../server.js';

/** Wraps a plain string as an MCP tool text-content result. */
export const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

/** Every gate/tool response opens with the active environment. */
export const banner = (rt: Runtime) =>
  rt.env === 'production' ? '⚠ PRODUCTION' : 'staging';
