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

/** Where a sub-content unit plausibly sits inside createSubUnit's response. */
const SUBUNIT_AT: ((p: Record<string, unknown>) => unknown)[] = [
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
const asSubContentUnit = (payload: unknown): SubContentUnit => {
  if (payload !== null && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
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
    `createSubUnit: no id in the response. Looked for id on the payload and on ` +
      `.subContentUnit/.data. The response actually contained: ${describeShape(payload)}. ` +
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
