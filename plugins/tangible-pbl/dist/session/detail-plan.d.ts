import type { ContentUnit, CourseSkill } from '../api/builder.js';
/** What the caller supplies for one sub-content unit. `minutes` is minutes. */
export interface SubUnitSpec {
    contentUnit: string;
    title: string;
    description?: string;
    minutes?: number;
    skills: string[];
}
export interface ResolvedSkill {
    coreCompetencyModelId: string;
    levelId: string;
    name: string;
}
export interface ResolvedSubUnit {
    contentUnitId: string;
    contentUnitTitle: string;
    title: string;
    description?: string;
    estimatedDuration?: number;
    skills: ResolvedSkill[];
}
/**
 * Resolves a caller-supplied breakdown against the live course, or throws.
 *
 * Pure and total: it either returns a fully resolved plan or throws having
 * written nothing. The detail gate depends on that — a partial resolution
 * would leave sub-units created for the valid half of a breakdown and nothing
 * for the rest, with no way to tell which.
 *
 * Every message names the offender by name. No id appears in any error: the
 * caller addresses everything by name and has no use for one.
 */
export declare const planSubUnits: (specs: SubUnitSpec[], units: ContentUnit[], courseSkills: CourseSkill[]) => ResolvedSubUnit[];
