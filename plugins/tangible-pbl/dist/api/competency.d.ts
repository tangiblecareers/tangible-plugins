import type { AuthManager } from '../auth.js';
import type { HttpClient } from '../http.js';
export interface CompetencyLevel {
    id: string;
    name: string;
}
/**
 * `Level` belongs to `CoreCompetencyModel` (a plain `hasMany` with no `as:`),
 * so the serialised key is the default plural `Levels`. Tolerate `levels`
 * (a differently-cased backend) and a bare array (the endpoint returning the
 * list directly) too, the same defensiveness asCourse in builder.ts applies
 * to the course envelope. When none match, throw naming the keys actually
 * present rather than returning [] — a silent empty fallback here is exactly
 * what let the original CourseSkill.Level bug fail late and far from its
 * cause, and this call is a plan-time gate, not a background poll.
 */
export declare const getCompetencyLevels: (http: HttpClient, auth: AuthManager, coreCompetencyModelId: string) => Promise<CompetencyLevel[]>;
