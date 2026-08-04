import type { Runtime } from '../server.js';
/** Wraps a plain string as an MCP tool text-content result. */
export declare const text: (s: string) => {
    content: {
        type: "text";
        text: string;
    }[];
};
/** Every gate/tool response opens with the active environment. */
export declare const banner: (rt: Runtime) => "staging" | "⚠ PRODUCTION";
