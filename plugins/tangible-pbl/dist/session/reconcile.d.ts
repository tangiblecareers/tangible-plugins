import type { Course, ContentUnit } from '../api/builder.js';
import type { CourseMemory } from './memory.js';
export interface Difference {
    what: string;
    detail: string;
}
/**
 * Pure comparison so it is testable without HTTP. Reports and never auto-fixes
 * — the backend is authoritative for content, and a memory that silently
 * rewrote itself to match would destroy the record this feature exists to keep.
 */
export declare const reconcile: (m: CourseMemory, course: Course, units: ContentUnit[]) => Difference[];
export declare const renderResume: (m: CourseMemory, course: Course, units: ContentUnit[], differences: Difference[]) => string;
