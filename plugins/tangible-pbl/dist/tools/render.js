/** Wraps a plain string as an MCP tool text-content result. */
export const text = (s) => ({ content: [{ type: 'text', text: s }] });
/** Every gate/tool response opens with the active environment. */
export const banner = (rt) => rt.env === 'production' ? '⚠ PRODUCTION' : 'staging';
