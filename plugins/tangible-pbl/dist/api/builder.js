import { call } from './call.js';
const base = (courseId) => `business/courses/${courseId}`;
const asArray = (payload, key) => {
    if (Array.isArray(payload))
        return payload;
    const v = payload?.[key];
    return Array.isArray(v) ? v : [];
};
export const createCourse = (http, auth, prompt) => call(http, auth, { method: 'POST', path: 'business/courses', body: { prompt } });
export const getCourse = (http, auth, courseId) => call(http, auth, { method: 'GET', path: base(courseId) });
export const addContext = (http, auth, courseId, category, value) => call(http, auth, {
    method: 'POST', path: `${base(courseId)}/course-contexts`, body: { category, value },
});
export const selectContext = (http, auth, courseId, contextId, isSelected) => call(http, auth, {
    method: 'PATCH', path: `${base(courseId)}/course-contexts/${contextId}`,
    body: { isSelected },
});
export const generateSkills = (http, auth, courseId) => call(http, auth, {
    method: 'POST', path: `${base(courseId)}/course-skills/generate`, body: {},
});
export const selectSkill = (http, auth, courseId, courseSkillId, isSelected) => call(http, auth, {
    method: 'PATCH', path: `${base(courseId)}/course-skills/${courseSkillId}`,
    body: { isSelected },
});
export const generateProblems = (http, auth, courseId) => call(http, auth, {
    method: 'POST', path: `${base(courseId)}/course-problems/generate`, body: {},
});
export const selectProblem = (http, auth, courseId, problemId, isSelected) => call(http, auth, {
    method: 'PATCH', path: `${base(courseId)}/course-problems/${problemId}`,
    body: { isSelected },
});
/**
 * Also flips the course INITIALIZING -> DRAFT server-side
 * (backend/src/controllers/business-course-content-unit.controller.ts:323-331),
 * which freezes contexts, skills and problems from that point on.
 */
export const generateContentUnits = async (http, auth, courseId) => {
    const payload = await call(http, auth, {
        method: 'POST', path: `${base(courseId)}/content-units/generate`, body: {},
    });
    return asArray(payload, 'contentUnits');
};
export const listContentUnits = async (http, auth, courseId) => {
    const payload = await call(http, auth, {
        method: 'GET', path: `${base(courseId)}/content-units`,
    });
    return asArray(payload, 'contentUnits');
};
