import { call } from './call.js';
const subUnits = (courseId, contentUnitId) => `business/courses/${courseId}/content-units/${contentUnitId}/sub-content-units`;
/** Mirrors builder.ts's asArray — the API returns either a bare array or a keyed object. */
const asArray = (payload, key) => {
    if (Array.isArray(payload))
        return payload;
    const v = payload?.[key];
    return Array.isArray(v) ? v : [];
};
/**
 * Sub-content units have no generate endpoint — unlike skills, problems and
 * content units, they are authored. `estimatedDuration` is in MINUTES; the
 * backend caps it at 60000 and requires a positive integer.
 */
export const createSubUnit = (http, auth, courseId, contentUnitId, values) => call(http, auth, {
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
});
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
