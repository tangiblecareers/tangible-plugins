import { call } from './call.js';
const subUnits = (courseId, contentUnitId) => `business/courses/${courseId}/content-units/${contentUnitId}/sub-content-units`;
/** Mirrors builder.ts's asArray — the API returns either a bare array or a keyed object. */
const asArray = (payload, key) => {
    if (Array.isArray(payload))
        return payload;
    const v = payload?.[key];
    return Array.isArray(v) ? v : [];
};
/** Mirrors builder.ts's describeShape — see asCourse there for why the error names keys
 * actually present instead of guessing at another one. */
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
/** Where a sub-content unit plausibly sits inside createSubUnit's response. */
const SUBUNIT_AT = [
    (p) => p,
    (p) => p.subContentUnit,
    (p) => p.data,
];
/**
 * Resolves the created sub-content unit from a response whose shape is not
 * documented — the same undocumented-envelope problem asCourse in builder.ts
 * exists to solve. `machine.ts` uses the result's `id` directly as the next
 * call's `subUnitId`; a wrapped payload here (`{ subContentUnit: {…} }`)
 * would otherwise post to `…/sub-content-units/undefined/skills` exactly the
 * way an unresolved course id once did. When no shape matches, throw naming
 * the keys actually present rather than returning something with an
 * undefined id.
 */
const asSubContentUnit = (payload) => {
    if (payload !== null && typeof payload === 'object') {
        const rec = payload;
        for (const pick of SUBUNIT_AT) {
            const candidate = pick(rec);
            if (candidate === null || typeof candidate !== 'object')
                continue;
            const c = candidate;
            const id = c.id;
            if (typeof id === 'string' && id.length > 0) {
                return c;
            }
        }
    }
    throw new Error(`createSubUnit: no id in the response. Looked for id on the payload and on ` +
        `.subContentUnit/.data. The response actually contained: ${describeShape(payload)}. ` +
        `Report this shape.`);
};
/**
 * Sub-content units have no generate endpoint — unlike skills, problems and
 * content units, they are authored. `estimatedDuration` is in MINUTES; the
 * backend caps it at 60000 and requires a positive integer.
 */
export const createSubUnit = async (http, auth, courseId, contentUnitId, values) => asSubContentUnit(await call(http, auth, {
    method: 'POST',
    path: subUnits(courseId, contentUnitId),
    // Send only what was given — the backend distinguishes absent from null.
    body: {
        title: values.title,
        ...(values.description !== undefined ? { description: values.description } : {}),
        ...(values.estimatedDuration !== undefined
            ? { estimatedDuration: values.estimatedDuration }
            : {}),
    },
}));
export const listSubUnits = async (http, auth, courseId, contentUnitId) => asArray(await call(http, auth, {
    method: 'GET', path: subUnits(courseId, contentUnitId),
}), 'subContentUnits');
/** Both ids are required by the backend; ten skills maximum per sub-unit. */
export const assignSkill = (http, auth, courseId, contentUnitId, subUnitId, body) => call(http, auth, {
    method: 'POST',
    path: `${subUnits(courseId, contentUnitId)}/${subUnitId}/skills`,
    body,
});
export const listSubUnitSkills = async (http, auth, courseId, contentUnitId, subUnitId) => asArray(await call(http, auth, {
    method: 'GET',
    path: `${subUnits(courseId, contentUnitId)}/${subUnitId}/skills`,
}), 'skills');
/** 409 when an artifact already exists — the caller treats that as satisfied. */
export const generateArtifact = (http, auth, courseId, contentUnitId, subUnitId, body = {}) => call(http, auth, {
    method: 'POST',
    path: `${subUnits(courseId, contentUnitId)}/${subUnitId}/artifact/generate`,
    body,
});
