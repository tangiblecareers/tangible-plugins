import type { Produced } from './machine.js';
import type { SessionState } from './store.js';
export declare const courseUrl: (appUrl: string, courseId: string) => string;
export declare const renderLedger: (state: SessionState) => string;
export declare const renderGate: (state: SessionState, opts: {
    appUrl: string;
    produced: Produced;
}) => string;
