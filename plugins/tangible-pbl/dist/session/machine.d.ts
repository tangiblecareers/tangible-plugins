import type { Course, CourseProblem, CourseSkill, ContentUnit } from '../api/builder.js';
import type { CourseMemory, Step } from './memory.js';
export declare const STEP_ORDER: Step[];
export declare const nextStep: (step: Step) => Step;
export interface MachineDeps {
    generateSkills(courseId: string): Promise<Course>;
    generateProblems(courseId: string): Promise<Course>;
    generateContentUnits(courseId: string): Promise<ContentUnit[]>;
    getCourse(courseId: string): Promise<Course>;
    selectSkill(courseId: string, courseSkillId: string, on: boolean): Promise<Course>;
    selectProblem(courseId: string, problemId: string, on: boolean): Promise<Course>;
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
}
export interface AdvanceResult {
    state: CourseMemory;
    produced: Produced;
}
export declare const assertRevisable: (state: CourseMemory, step: Step) => void;
export declare const advance: (deps: MachineDeps, state: CourseMemory, input?: ApproveInput) => Promise<AdvanceResult>;
