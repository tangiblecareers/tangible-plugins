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
/** Where a sub-content unit plausibly sits inside createSubUnit's response,
 * when the response is a single object rather than a list. */
const SUBUNIT_AT = [
    (p) => p,
    (p) => p.subContentUnit,
    (p) => p.data,
];
/**
 * Picks the entry with the highest `sortOrder` out of a list, via an
 * explicit running comparison — never `list[list.length - 1]` or
 * `list.at(-1)`. The backend documents the list as `sortOrder ASC`, but a
 * position-based read is one backend change away from silently picking the
 * wrong entry; a comparison on the field that actually encodes "most
 * recently created" cannot be fooled by a reordering. Returns undefined for
 * an empty list.
 */
const highestSortOrder = (list) => {
    let best;
    let bestOrder = -Infinity;
    for (const item of list) {
        const order = typeof item.sortOrder === 'number' ? item.sortOrder : -Infinity;
        if (best === undefined || order > bestOrder) {
            best = item;
            bestOrder = order;
        }
    }
    return best;
};
/**
 * Resolves the created sub-content unit from a response whose shape is not
 * documented — the same undocumented-envelope problem asCourse in builder.ts
 * exists to solve. `machine.ts` uses the result's `id` directly as the next
 * call's `subUnitId`; a wrapped payload here (`{ subContentUnit: {…} }`)
 * would otherwise post to `…/sub-content-units/undefined/skills` exactly the
 * way an unresolved course id once did.
 *
 * `POST sub-content-units` actually responds with `subContentUnits` — the
 * **whole list** for the content unit (`listAllSubContentUnits`), ordered
 * `sortOrder ASC`, not the created object. The new unit is created with
 * `sortOrder: maxSortOrder + 1`, so on a course with any prior sub-units it
 * lands last, never first — `subContentUnits[0]` would silently resolve to
 * whichever unit was created *first*, and every skill assignment after that
 * would attach to the wrong lesson with no error at all. So the created
 * entry is picked by the highest `sortOrder` (see `highestSortOrder`), and
 * that alone is not treated as identity: its `title` must also equal
 * `sentTitle`, the title this exact call just sent. A mismatch means either
 * a concurrent creation on the same content unit landed with a higher
 * `sortOrder`, or the response shape has changed — either way, guessing
 * would risk attaching skills to the wrong lesson, so this throws instead.
 *
 * When no shape matches at all, throw naming the keys actually present
 * rather than returning something with an undefined id.
 */
const asSubContentUnit = (payload, sentTitle) => {
    if (payload !== null && typeof payload === 'object') {
        const rec = payload;
        const list = rec.subContentUnits;
        if (Array.isArray(list) && list.length > 0) {
            const candidate = highestSortOrder(list);
            if (candidate) {
                const id = candidate.id;
                if (typeof id === 'string' && id.length > 0) {
                    const title = candidate.title;
                    if (title !== sentTitle) {
                        throw new Error(`createSubUnit: could not identify the created sub-unit in the returned list. ` +
                            `The entry with the highest sortOrder is titled "${String(title)}", but this ` +
                            `call sent "${sentTitle}". That means either a concurrent creation on the same ` +
                            `content unit, or a response-shape change — guessing would risk attaching ` +
                            `skills to the wrong lesson.`);
                    }
                    return candidate;
                }
            }
        }
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
    throw new Error(`createSubUnit: no id in the response. Looked for id on the payload, on ` +
        `.subContentUnit/.data, and for a sub-content-unit list under .subContentUnits. ` +
        `The response actually contained: ${describeShape(payload)}. ` +
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
}), 
// asSubContentUnit needs the title this call sent to positively identify
// the created entry in a returned list, rather than guessing by position.
values.title);
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
