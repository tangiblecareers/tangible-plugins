import type { AuthManager } from '../auth.js';
import type { HttpClient } from '../http.js';
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
/**
 * Sub-content units have no generate endpoint — unlike skills, problems and
 * content units, they are authored. `estimatedDuration` is in MINUTES; the
 * backend caps it at 60000 and requires a positive integer.
 */
export declare const createSubUnit: (http: HttpClient, auth: AuthManager, courseId: string, contentUnitId: string, values: {
    title: string;
    description?: string;
    estimatedDuration?: number;
}) => Promise<SubContentUnit>;
export declare const listSubUnits: (http: HttpClient, auth: AuthManager, courseId: string, contentUnitId: string) => Promise<SubContentUnit[]>;
/** Both ids are required by the backend; ten skills maximum per sub-unit. */
export declare const assignSkill: (http: HttpClient, auth: AuthManager, courseId: string, contentUnitId: string, subUnitId: string, body: {
    coreCompetencyModelId: string;
    levelId: string;
}) => Promise<unknown>;
export declare const listSubUnitSkills: (http: HttpClient, auth: AuthManager, courseId: string, contentUnitId: string, subUnitId: string) => Promise<SubUnitSkill[]>;
/** 409 when an artifact already exists — the caller treats that as satisfied. */
export declare const generateArtifact: (http: HttpClient, auth: AuthManager, courseId: string, contentUnitId: string, subUnitId: string, body?: {
    instruction?: string;
}) => Promise<unknown>;
