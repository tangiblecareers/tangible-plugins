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
 * Flattens the backend's grouped-by-category `CourseContexts` shape into the
 * real array `Course.CourseContexts` promises.
 *
 * `Course.CourseContexts` is typed as `CourseContext[]`, but every handler
 * that returns a course runs `Object.groupBy(contexts, c => c.category)`
 * before responding — `createCourse` and `getCourse` in
 * `business-course.controller.ts`, and all four handlers (add, select,
 * update, delete) in `business-course-context.controller.ts`. Six call
 * sites, and none of them ever send a bare array. What actually comes over
 * the wire looks like:
 *   { DURATION: [...], LEARNING_OUTCOME: [...], LEARNER_PROFILE: [...] }
 * Without this, `seed.map` in `applyContexts` (src/tools/session.ts) throws
 * "seed.map is not a function" the instant a caller passes `contexts` — the
 * grouped object isn't nullish, so a plain `?? []` never catches it.
 *
 * Defaulting a non-array straight to `[]` would trade that crash for
 * something worse: a freshly-created course already has AI-generated
 * contexts, some already `isSelected` (see item 2 in CLAUDE.md). An empty
 * seed makes `applyContexts`' `all.find((cc) => !known.has(cc.id))` match one
 * of those pre-existing contexts instead of the one just created, and the
 * caller silently selects/deselects the wrong context. So: flatten when
 * there's something to flatten, and only fall back to `[]` when there
 * genuinely is nothing (absent/null/wrong-shaped) — contexts are incidental
 * to most calls, and a course fetch should not fail over them.
 *
 * Order is deliberate, not incidental: `Object.groupBy` inserts each
 * category key the first time it's seen scanning the source array, and the
 * backend's source array is already ordered `createdAt ASC, id ASC`. Plain
 * string keys keep their insertion order through JSON (stringify writes them
 * in that order, parse rebuilds them in that order), so `Object.keys` here
 * reproduces that exact same first-appearance/createdAt order — do not sort
 * it. Alphabetical order (DURATION, LEARNING_OUTCOME, LEARNER_PROFILE) would
 * not match creation order and would disagree with how the backend and the
 * web app present the same contexts. Each category's own array is already in
 * the backend's order, so concatenating group-by-group in that key order is
 * the whole algorithm.
 */
const asContexts = (raw) => {
    if (Array.isArray(raw))
        return raw;
    if (raw !== null && typeof raw === 'object') {
        return Object.values(raw)
            .filter((group) => Array.isArray(group))
            .flat();
    }
    return [];
};
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
                    return {
                        ...c,
                        id,
                        CourseContexts: asContexts(c.CourseContexts),
                    };
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
