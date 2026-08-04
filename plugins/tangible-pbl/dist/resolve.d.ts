import type { AuthManager } from './auth.js';
import type { HttpClient } from './http.js';
export interface BusinessSummary {
    id: string;
    name: string;
}
/** GET user/business — frontend/src/api/endpoints.ts:168. */
export declare const listBusinesses: (http: HttpClient, auth: AuthManager) => Promise<BusinessSummary[]>;
export declare const resolveBusiness: (http: HttpClient, auth: AuthManager, name: string) => Promise<BusinessSummary>;
