import type { AuthManager } from '../auth.js';
import type { HttpClient } from '../http.js';
import { call } from './call.js';

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
  CoreCompetencyModel: { id: string; name: string };
  Level?: { id: string; name: string };
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
  CourseContexts?: CourseContext[];
  CourseSkills?: CourseSkill[];
  CourseProblems?: CourseProblem[];
}

export interface ContentUnit {
  id: string;
  title: string;
  order?: number;
}

const base = (courseId: string) => `business/courses/${courseId}`;

const asArray = <T>(payload: T[] | Record<string, unknown> | undefined, key: string): T[] => {
  if (Array.isArray(payload)) return payload;
  const v = (payload as Record<string, unknown> | undefined)?.[key];
  return Array.isArray(v) ? (v as T[]) : [];
};

export const createCourse = (http: HttpClient, auth: AuthManager, prompt: string) =>
  call<Course>(http, auth, { method: 'POST', path: 'business/courses', body: { prompt } });

export const getCourse = (http: HttpClient, auth: AuthManager, courseId: string) =>
  call<Course>(http, auth, { method: 'GET', path: base(courseId) });

export const addContext = (
  http: HttpClient, auth: AuthManager, courseId: string,
  category: ContextCategory, value: string,
) =>
  call<Course>(http, auth, {
    method: 'POST', path: `${base(courseId)}/course-contexts`, body: { category, value },
  });

export const selectContext = (
  http: HttpClient, auth: AuthManager, courseId: string,
  contextId: string, isSelected: boolean,
) =>
  call<Course>(http, auth, {
    method: 'PATCH', path: `${base(courseId)}/course-contexts/${contextId}`,
    body: { isSelected },
  });

export const generateSkills = (http: HttpClient, auth: AuthManager, courseId: string) =>
  call<Course>(http, auth, {
    method: 'POST', path: `${base(courseId)}/course-skills/generate`, body: {},
  });

export const selectSkill = (
  http: HttpClient, auth: AuthManager, courseId: string,
  courseSkillId: string, isSelected: boolean,
) =>
  call<Course>(http, auth, {
    method: 'PATCH', path: `${base(courseId)}/course-skills/${courseSkillId}`,
    body: { isSelected },
  });

export const generateProblems = (http: HttpClient, auth: AuthManager, courseId: string) =>
  call<Course>(http, auth, {
    method: 'POST', path: `${base(courseId)}/course-problems/generate`, body: {},
  });

export const selectProblem = (
  http: HttpClient, auth: AuthManager, courseId: string,
  problemId: string, isSelected: boolean,
) =>
  call<Course>(http, auth, {
    method: 'PATCH', path: `${base(courseId)}/course-problems/${problemId}`,
    body: { isSelected },
  });

/**
 * Also flips the course INITIALIZING -> DRAFT server-side
 * (backend/src/controllers/business-course-content-unit.controller.ts:323-331),
 * which freezes contexts, skills and problems from that point on.
 */
export const generateContentUnits = async (
  http: HttpClient, auth: AuthManager, courseId: string,
): Promise<ContentUnit[]> => {
  const payload = await call<ContentUnit[] | Record<string, unknown>>(http, auth, {
    method: 'POST', path: `${base(courseId)}/content-units/generate`, body: {},
  });
  return asArray<ContentUnit>(payload, 'contentUnits');
};

export const listContentUnits = async (
  http: HttpClient, auth: AuthManager, courseId: string,
): Promise<ContentUnit[]> => {
  const payload = await call<ContentUnit[] | Record<string, unknown>>(http, auth, {
    method: 'GET', path: `${base(courseId)}/content-units`,
  });
  return asArray<ContentUnit>(payload, 'contentUnits');
};
