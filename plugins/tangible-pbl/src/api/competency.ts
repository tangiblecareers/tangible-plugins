import type { AuthManager } from '../auth.js';
import type { HttpClient } from '../http.js';
import { call } from './call.js';

export interface CompetencyLevel {
  id: string;
  name: string;
}

/** Shallow key map, so one failure identifies the real shape without a probe.
 * Mirrors describeShape in builder.ts — see asCourse there for the house style. */
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
export const getCompetencyLevels = async (
  http: HttpClient,
  auth: AuthManager,
  coreCompetencyModelId: string,
): Promise<CompetencyLevel[]> => {
  const payload = await call<unknown>(http, auth, {
    method: 'GET',
    path: `business/competencies/${coreCompetencyModelId}`,
  });

  if (payload !== null && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    for (const key of ['Levels', 'levels']) {
      const v = rec[key];
      if (Array.isArray(v)) return v as CompetencyLevel[];
    }
  }
  if (Array.isArray(payload)) return payload as CompetencyLevel[];

  throw new Error(
    `GET business/competencies/:id: no Levels in the response. Looked for ` +
      `Levels/levels on the payload, and a bare array. The response actually ` +
      `contained: ${describeShape(payload)}. Report this shape.`,
  );
};
