import type { ContentUnit, CourseSkill } from '../api/builder.js';
import type { CompetencyLevel } from '../api/competency.js';
/** One skill assigned to a sub-content unit, and the level to assign it at. */
export interface SubUnitSkillSpec {
    name: string;
    /** By name. Omit only when the skill's competency has exactly one level. */
    level?: string;
}
/** What the caller supplies for one sub-content unit. `minutes` is minutes. */
export interface SubUnitSpec {
    contentUnit: string;
    title: string;
    description?: string;
    minutes?: number;
    skills: SubUnitSkillSpec[];
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
 * Pure and total: it never fetches, and it either returns a fully resolved
 * plan or throws having written nothing. `levelsByCompetencyId` must already
 * hold every selected skill's levels the breakdown could reference — the
 * caller (the "detail" case in machine.ts) collects the distinct skill names
 * across the whole breakdown and fetches each competency's levels once,
 * before calling this and before any write. That split matters for two
 * reasons: a partial resolution here would leave sub-units created for the
 * valid half of a breakdown with no way to tell which, and a fetch buried in
 * a pure resolver would make "validate everything before the first write"
 * impossible to guarantee.
 *
 * A skill is no longer resolved via `CourseSkill.Level` — that field does not
 * exist on the backend and never can (see CLAUDE.md). The level is chosen
 * per sub-unit, against the skill's competency's own levels.
 *
 * Every message names the offender by name. No id appears in any error: the
 * caller addresses everything by name and has no use for one.
 */
export declare const planSubUnits: (specs: SubUnitSpec[], units: ContentUnit[], courseSkills: CourseSkill[], levelsByCompetencyId: Map<string, CompetencyLevel[]>) => ResolvedSubUnit[];
