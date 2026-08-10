import type { AuthManager } from '../auth.js';
import type { HttpClient } from '../http.js';
export type ContextCategory = 'DURATION' | 'LEARNING_OUTCOME' | 'LEARNER_PROFILE';
export type CourseStatus = 'INITIALIZING' | 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export interface CourseContext {
    id: string;
    category: ContextCategory;
    value: string;
    isSelected: boolean;
}
export interface CourseSkill {
    id: string;
    isSelected: boolean;
    CoreCompetencyModel: {
        id: string;
        name: string;
    };
}
export interface CourseProblem {
    id: string;
    title?: string;
    description?: string;
    isSelected: boolean;
}
export interface Course {
    id: string;
    title?: string;
    status: CourseStatus;
    CourseContexts: CourseContext[];
    CourseSkills?: CourseSkill[];
    CourseProblems?: CourseProblem[];
}
export interface ContentUnit {
    id: string;
    title: string;
    order?: number;
}
/**
 * Resolves the course and its id from a response whose shape is not documented.
 *
 * A live staging run created a course whose payload was truthy but carried no
 * `id`, so `course.id` was undefined and every following call went to
 * `business/courses/undefined/...`. Rather than pin one key and fail opaquely
 * again, look through the shapes the API plausibly uses; when none match, throw
 * naming every key actually present, nested one level. The error is the
 * diagnostic — one failed call identifies the shape, with no probe script and
 * no guessing.
 */
export declare const asCourse: (payload: unknown, where: string) => Course;
export declare const createCourse: (http: HttpClient, auth: AuthManager, prompt: string) => Promise<Course>;
export declare const getCourse: (http: HttpClient, auth: AuthManager, courseId: string) => Promise<Course>;
export declare const addContext: (http: HttpClient, auth: AuthManager, courseId: string, category: ContextCategory, value: string) => Promise<Course>;
export declare const selectContext: (http: HttpClient, auth: AuthManager, courseId: string, contextId: string, isSelected: boolean) => Promise<Course>;
export declare const generateSkills: (http: HttpClient, auth: AuthManager, courseId: string) => Promise<Course>;
export declare const selectSkill: (http: HttpClient, auth: AuthManager, courseId: string, courseSkillId: string, isSelected: boolean) => Promise<Course>;
export declare const generateProblems: (http: HttpClient, auth: AuthManager, courseId: string) => Promise<Course>;
export declare const selectProblem: (http: HttpClient, auth: AuthManager, courseId: string, problemId: string, isSelected: boolean) => Promise<Course>;
/**
 * Also flips the course INITIALIZING -> DRAFT server-side
 * (backend/src/controllers/business-course-content-unit.controller.ts:323-331),
 * which freezes contexts, skills and problems from that point on.
 */
export declare const generateContentUnits: (http: HttpClient, auth: AuthManager, courseId: string) => Promise<ContentUnit[]>;
export declare const listContentUnits: (http: HttpClient, auth: AuthManager, courseId: string) => Promise<ContentUnit[]>;
