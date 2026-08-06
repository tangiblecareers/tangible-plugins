import { call } from './call.js';
const base = (courseId) => `business/courses/${courseId}`;
/** Shallow key map, so one failure identifies the real shape without a probe. */
const describeShape = (v) => {
    if (v === null || typeof v !== 'object')
        return typeof v;
    const rec = v;
    return Object.keys(rec)
        .map((k) => {
        const inner = rec[k];
        if (inner !== null && typeof inner === 'object' && !Array.isArray(inner)) {
            return `${k}{${Object.keys(inner).join(',')}}`;
        }
        return k;
    })
        .join(', ');
};
/** Where a course object plausibly sits inside a response payload. */
const COURSE_AT = [
    (p) => p,
    (p) => p.course,
    (p) => p.Course,
    (p) => p.data,
    (p) => p.courseData,
];
/** Where the id plausibly sits inside a course object. */
const ID_AT = ['id', 'courseId', 'uuid', '_id'];
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
export const asCourse = (payload, where) => {
    if (payload !== null && typeof payload === 'object') {
        const rec = payload;
        for (const pick of COURSE_AT) {
            const candidate = pick(rec);
            if (candidate === null || typeof candidate !== 'object')
                continue;
            const c = candidate;
            for (const key of ID_AT) {
                const id = c[key];
                if (typeof id === 'string' && id.length > 0) {
                    return { ...c, id };
                }
            }
        }
    }
    throw new Error(`${where}: no course id in the response. Looked for ` +
        `${ID_AT.join('/')} on the payload and on .course/.Course/.data/.courseData. ` +
        `The response actually contained: ${describeShape(payload)}. ` +
        `Report this shape — the client needs one more path added to asCourse().`);
};
const asArray = (payload, key) => {
    if (Array.isArray(payload))
        return payload;
    const v = payload?.[key];
    return Array.isArray(v) ? v : [];
};
/**
 * Every course-returning endpoint goes through here, so the response shape is
 * resolved in exactly one place. If the API wraps its course object, it almost
 * certainly wraps it the same way everywhere — pinning the shape per call site
 * is how one endpoint gets fixed and the next one fails a gate later.
 */
const courseCall = async (http, auth, where, opts) => asCourse(await call(http, auth, opts), where);
export const createCourse = (http, auth, prompt) => courseCall(http, auth, 'POST business/courses', {
    method: 'POST', path: 'business/courses', body: { prompt },
});
export const getCourse = (http, auth, courseId) => courseCall(http, auth, 'GET business/courses/:id', {
    method: 'GET', path: base(courseId),
});
export const addContext = (http, auth, courseId, category, value) => courseCall(http, auth, 'POST course-contexts', {
    method: 'POST', path: `${base(courseId)}/course-contexts`, body: { category, value },
});
export const selectContext = (http, auth, courseId, contextId, isSelected) => courseCall(http, auth, 'PATCH course-contexts/:id', {
    method: 'PATCH', path: `${base(courseId)}/course-contexts/${contextId}`,
    body: { isSelected },
});
export const generateSkills = (http, auth, courseId) => courseCall(http, auth, 'POST course-skills/generate', {
    method: 'POST', path: `${base(courseId)}/course-skills/generate`, body: {},
});
export const selectSkill = (http, auth, courseId, courseSkillId, isSelected) => courseCall(http, auth, 'PATCH course-skills/:id', {
    method: 'PATCH', path: `${base(courseId)}/course-skills/${courseSkillId}`,
    body: { isSelected },
});
export const generateProblems = (http, auth, courseId) => courseCall(http, auth, 'POST course-problems/generate', {
    method: 'POST', path: `${base(courseId)}/course-problems/generate`, body: {},
});
export const selectProblem = (http, auth, courseId, problemId, isSelected) => courseCall(http, auth, 'PATCH course-problems/:id', {
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
