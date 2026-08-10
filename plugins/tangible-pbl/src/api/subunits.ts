import type { AuthManager } from '../auth.js';
import type { HttpClient } from '../http.js';
import { call } from './call.js';

export interface SubContentUnit {
  id: string;
  title: string;
  description?: string | null;
  estimatedDuration?: number | null;
  sortOrder?: number;
}

export interface SubUnitSkill {
  coreCompetencyModelId: string;
  levelId?: string;
  name?: string;
}

const subUnits = (courseId: string, contentUnitId: string) =>
  `business/courses/${courseId}/content-units/${contentUnitId}/sub-content-units`;

/** Mirrors builder.ts's asArray — the API returns either a bare array or a keyed object. */
const asArray = <T>(payload: unknown, key: string): T[] => {
  if (Array.isArray(payload)) return payload as T[];
  const v = (payload as Record<string, unknown> | undefined)?.[key];
  return Array.isArray(v) ? (v as T[]) : [];
};

/** Mirrors builder.ts's describeShape — see asCourse there for why the error names keys
 * actually present instead of guessing at another one. */
const describeShape = (v: unknown): string => {
  if (v === null || typeof v !== 'object') return typeof v;
  const rec = v as Record<string, unknown>;
  return Object.keys(rec)
    .map((k) => {
      const inner = rec[k];
      if (inner !== null && typeof inner === 'object' && !Array.isArray(inner)) {
        return `${k}{${Object.keys(inner as Record<string, unknown>).join(',')}}`;
      }
      return k;
    })
    .join(', ');
};

/** Where a sub-content unit plausibly sits inside createSubUnit's response,
 * when the response is a single object rather than a list. */
const SUBUNIT_AT: ((p: Record<string, unknown>) => unknown)[] = [
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
const highestSortOrder = (
  list: Record<string, unknown>[],
): Record<string, unknown> | undefined => {
  let best: Record<string, unknown> | undefined;
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
const asSubContentUnit = (payload: unknown, sentTitle: string): SubContentUnit => {
  if (payload !== null && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;

    const list = rec.subContentUnits;
    if (Array.isArray(list) && list.length > 0) {
      const candidate = highestSortOrder(list as Record<string, unknown>[]);
      if (candidate) {
        const id = candidate.id;
        if (typeof id === 'string' && id.length > 0) {
          const title = candidate.title;
          if (title !== sentTitle) {
            throw new Error(
              `createSubUnit: could not identify the created sub-unit in the returned list. ` +
                `The entry with the highest sortOrder is titled "${String(title)}", but this ` +
                `call sent "${sentTitle}". That means either a concurrent creation on the same ` +
                `content unit, or a response-shape change — guessing would risk attaching ` +
                `skills to the wrong lesson.`,
            );
          }
          return candidate as unknown as SubContentUnit;
        }
      }
    }

    for (const pick of SUBUNIT_AT) {
      const candidate = pick(rec);
      if (candidate === null || typeof candidate !== 'object') continue;
      const c = candidate as Record<string, unknown>;
      const id = c.id;
      if (typeof id === 'string' && id.length > 0) {
        return c as unknown as SubContentUnit;
      }
    }
  }
  throw new Error(
    `createSubUnit: no id in the response. Looked for id on the payload, on ` +
      `.subContentUnit/.data, and for a sub-content-unit list under .subContentUnits. ` +
      `The response actually contained: ${describeShape(payload)}. ` +
      `Report this shape.`,
  );
};

/**
 * Sub-content units have no generate endpoint — unlike skills, problems and
 * content units, they are authored. `estimatedDuration` is in MINUTES; the
 * backend caps it at 60000 and requires a positive integer.
 */
export const createSubUnit = async (
  http: HttpClient, auth: AuthManager,
  courseId: string, contentUnitId: string,
  values: { title: string; description?: string; estimatedDuration?: number },
): Promise<SubContentUnit> =>
  asSubContentUnit(
    await call<unknown>(http, auth, {
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
    values.title,
  );

export const listSubUnits = async (
  http: HttpClient, auth: AuthManager, courseId: string, contentUnitId: string,
): Promise<SubContentUnit[]> =>
  asArray<SubContentUnit>(
    await call<unknown>(http, auth, {
      method: 'GET', path: subUnits(courseId, contentUnitId),
    }),
    'subContentUnits',
  );

/** Both ids are required by the backend; ten skills maximum per sub-unit. */
export const assignSkill = (
  http: HttpClient, auth: AuthManager,
  courseId: string, contentUnitId: string, subUnitId: string,
  body: { coreCompetencyModelId: string; levelId: string },
) =>
  call<unknown>(http, auth, {
    method: 'POST',
    path: `${subUnits(courseId, contentUnitId)}/${subUnitId}/skills`,
    body,
  });

export const listSubUnitSkills = async (
  http: HttpClient, auth: AuthManager,
  courseId: string, contentUnitId: string, subUnitId: string,
): Promise<SubUnitSkill[]> =>
  asArray<SubUnitSkill>(
    await call<unknown>(http, auth, {
      method: 'GET',
      path: `${subUnits(courseId, contentUnitId)}/${subUnitId}/skills`,
    }),
    'skills',
  );

/** 409 when an artifact already exists — the caller treats that as satisfied. */
export const generateArtifact = (
  http: HttpClient, auth: AuthManager,
  courseId: string, contentUnitId: string, subUnitId: string,
  body: { instruction?: string } = {},
) =>
  call<unknown>(http, auth, {
    method: 'POST',
    path: `${subUnits(courseId, contentUnitId)}/${subUnitId}/artifact/generate`,
    body,
  });
