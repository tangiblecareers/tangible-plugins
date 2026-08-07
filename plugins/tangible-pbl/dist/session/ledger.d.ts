import type { Produced } from './machine.js';
import type { CourseMemory } from './memory.js';
import type { SubUnitSkill } from '../api/subunits.js';
export declare const courseUrl: (appUrl: string, courseId: string) => string;
export declare const renderLedger: (state: CourseMemory) => string;
/** One sub-content unit with its skills, as pbl_status fetches them. */
export interface BreakdownSubUnit {
    title: string;
    skills: SubUnitSkill[];
}
/** One content unit with its sub-units, as pbl_status fetches them. */
export interface BreakdownUnit {
    title: string;
    subs: BreakdownSubUnit[];
}
/**
 * Renders the content-unit / sub-unit / skill breakdown pbl_status shows once
 * the "detail" step is reached. This is how an operator confirms the detail
 * gate did what they approved, and spots a sub-unit that would block
 * pbl_publish before running it.
 *
 * `SubUnitSkill.name` is optional (subunits.ts) — the backend can return a
 * skill with only a bare `coreCompetencyModelId`. Rendering that id would be
 * a UUID leak, breaching this plugin's standing non-negotiable. A sub-unit
 * whose skills are not all named therefore renders as a count instead of a
 * name list — do NOT "fix" this by falling back to the id.
 */
export declare const renderBreakdown: (units: BreakdownUnit[]) => string;
/**
 * One selected skill's levels, as pbl_status fetches them via
 * getCompetencyLevels. `levels: null` means that one lookup failed —
 * pbl_status is read-only and a partial answer beats none, so one failing
 * competency must not blank the whole section.
 */
export interface SkillLevelsEntry {
    name: string;
    levels: string[] | null;
}
/**
 * Renders the selected skills and their available levels, shown by
 * pbl_status from the "skills" gate onward — this is the only place a
 * caller can discover level names before guessing wrong at the "detail"
 * gate and reading the error. A skill with no levels renders `(no levels)`
 * rather than being omitted: that is precisely what an operator must see and
 * fix in the app before "detail" will accept it. Names only, never a level
 * or competency id.
 */
export declare const renderSkills: (skills: SkillLevelsEntry[]) => string;
export declare const renderGate: (state: CourseMemory, opts: {
    appUrl: string;
    produced: Produced;
}) => string;
