import { call } from './call.js';
/** Shallow key map, so one failure identifies the real shape without a probe.
 * Mirrors describeShape in builder.ts — see asCourse there for the house style. */
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
/**
 * `Level` belongs to `CoreCompetencyModel` (a plain `hasMany` with no `as:`),
 * so the serialised key is the default plural `Levels`. Tolerate `levels`
 * (a differently-cased backend) and a bare array (the endpoint returning the
 * list directly) too, the same defensiveness asCourse in builder.ts applies
 * to the course envelope. When none match, throw naming the keys actually
 * present rather than returning [] — a silent empty fallback here is exactly
 * what let the original CourseSkill.Level bug fail late and far from its
 * cause, and this call is a plan-time gate, not a background poll.
 */
export const getCompetencyLevels = async (http, auth, coreCompetencyModelId) => {
    const payload = await call(http, auth, {
        method: 'GET',
        path: `business/competencies/${coreCompetencyModelId}`,
    });
    if (payload !== null && typeof payload === 'object') {
        const rec = payload;
        for (const key of ['Levels', 'levels']) {
            const v = rec[key];
            if (Array.isArray(v))
                return v;
        }
    }
    if (Array.isArray(payload))
        return payload;
    throw new Error(`GET business/competencies/:id: no Levels in the response. Looked for ` +
        `Levels/levels on the payload, and a bare array. The response actually ` +
        `contained: ${describeShape(payload)}. Report this shape.`);
};
