import type { Course, CourseProblem, CourseSkill, ContentUnit } from '../api/builder.js';
import type { CompetencyLevel } from '../api/competency.js';
import type { CourseMemory, Step } from './memory.js';
import { type SubUnitSpec } from './detail-plan.js';
import type { SubContentUnit } from '../api/subunits.js';
export declare const STEP_ORDER: Step[];
export declare const nextStep: (step: Step) => Step;
export interface MachineDeps {
    generateSkills(courseId: string): Promise<Course>;
    generateProblems(courseId: string): Promise<Course>;
    generateContentUnits(courseId: string): Promise<ContentUnit[]>;
    getCourse(courseId: string): Promise<Course>;
    selectSkill(courseId: string, courseSkillId: string, on: boolean): Promise<Course>;
    selectProblem(courseId: string, problemId: string, on: boolean): Promise<Course>;
    listContentUnits(courseId: string): Promise<ContentUnit[]>;
    createSubUnit(courseId: string, contentUnitId: string, values: {
        title: string;
        description?: string;
        estimatedDuration?: number;
    }): Promise<SubContentUnit>;
    assignSkill(courseId: string, contentUnitId: string, subUnitId: string, body: {
        coreCompetencyModelId: string;
        levelId: string;
    }): Promise<unknown>;
    /** No CourseSkill carries a level — this is how the detail gate finds one. */
    getCompetencyLevels(coreCompetencyModelId: string): Promise<CompetencyLevel[]>;
    listSubUnits(courseId: string, contentUnitId: string): Promise<SubContentUnit[]>;
    generateArtifact(courseId: string, contentUnitId: string, subUnitId: string, body: {
        instruction?: string;
    }): Promise<unknown>;
    publish(courseId: string): Promise<Course>;
    invite(courseId: string, emails: string[]): Promise<unknown>;
    onProgress?(message: string): void;
}
export type Produced = {
    kind: 'skills';
    skills: CourseSkill[];
} | {
    kind: 'problems';
    problems: CourseProblem[];
} | {
    kind: 'outline';
    units: ContentUnit[];
} | {
    kind: 'detail';
    created: {
        contentUnitTitle: string;
        title: string;
        skills: string[];
    }[];
} | {
    kind: 'artifacts';
    generated: string[];
    failed: {
        title: string;
        reason: string;
    }[];
} | {
    kind: 'published';
} | {
    kind: 'invited';
    count: number;
} | {
    kind: 'none';
};
export interface ApproveInput {
    /** Skill names to keep selected; everything else is deselected. */
    selectSkills?: string[];
    /** Problem title, id, or a unique prefix of either, to select. */
    selectProblem?: string;
    emails?: string[];
    /** The sub-content-unit breakdown, required when advancing to "detail". */
    subUnits?: SubUnitSpec[];
    /** Optional steer applied to every artifact generated at the "artifacts" gate. */
    instruction?: string;
}
export interface AdvanceResult {
    state: CourseMemory;
    produced: Produced;
}
export declare const assertRevisable: (state: CourseMemory, step: Step) => void;
export declare const advance: (deps: MachineDeps, state: CourseMemory, input?: ApproveInput) => Promise<AdvanceResult>;
