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

/**
 * Sub-content units have no generate endpoint — unlike skills, problems and
 * content units, they are authored. `estimatedDuration` is in MINUTES; the
 * backend caps it at 60000 and requires a positive integer.
 */
export const createSubUnit = (
  http: HttpClient, auth: AuthManager,
  courseId: string, contentUnitId: string,
  values: { title: string; description?: string; estimatedDuration?: number },
) =>
  call<SubContentUnit>(http, auth, {
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
