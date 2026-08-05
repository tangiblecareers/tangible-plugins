import type { Env } from '../config.js';
export type Step = 'context' | 'skills' | 'problems' | 'outline' | 'detail' | 'publish' | 'invite' | 'done';
export type CourseStatusLabel = 'active' | 'closed' | 'published';
/**
 * One authored course. `id` is the slug, which is also the filename stem — it
 * is never read from the frontmatter, so renaming a file renames the course.
 */
export interface CourseMemory {
    id: string;
    title: string;
    env: Env;
    courseId: string;
    businessName: string;
    brief: string;
    sourceUrl?: string;
    step: Step;
    awaitingApproval: boolean;
    status: CourseStatusLabel;
    created: string;
    updated: string;
}
export interface LogEntry {
    step: Step;
    action: 'approved' | 'revised' | 'published' | 'invited' | 'closed';
    detail: string;
}
/**
 * Flat `key: value` only, values JSON-encoded. A real YAML parser would be a
 * new dependency for a format we fully control, and JSON encoding is what lets
 * colons, quotes and unicode round-trip without escaping rules of our own.
 * Anything free-form (the brief, rationale) lives in the body, where it cannot
 * break parsing.
 */
export declare const serializeFrontmatter: (m: CourseMemory) => string;
export declare const parseFrontmatter: (text: string, file: string) => Record<string, unknown>;
export declare const splitDocument: (text: string, file: string) => {
    front: Record<string, unknown>;
    body: string;
};
/**
 * `Course.title` is optional on the API, so the brief is the fallback. The
 * result always satisfies assertSafeId — non-latin titles kebab to '' and fall
 * through, and 'course' is the last resort when both inputs are unusable.
 */
export declare const slugify: (title: string | undefined, brief: string) => string;
