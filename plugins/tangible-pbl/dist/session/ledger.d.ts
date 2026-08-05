import type { Produced } from './machine.js';
import type { CourseMemory } from './memory.js';
export declare const courseUrl: (appUrl: string, courseId: string) => string;
export declare const renderLedger: (state: CourseMemory) => string;
export declare const renderGate: (state: CourseMemory, opts: {
    appUrl: string;
    produced: Produced;
}) => string;
