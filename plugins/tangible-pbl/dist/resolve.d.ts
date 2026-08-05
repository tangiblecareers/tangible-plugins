import type { AuthManager } from './auth.js';
import type { HttpClient } from './http.js';
export interface BusinessSummary {
    id: string;
    name: string;
    role?: string;
}
/**
 * There is no endpoint that lists a user's businesses. The web app derives the
 * switcher list from the user profile's `usersInBusiness` rows
 * (frontend/src/data/user/useUserTopNav.ts), and this does the same.
 *
 * The profile only carries `usersInBusiness` when you ask for your OWN id —
 * `user.controller.ts:50` attaches it behind `USER_IS_SELF || USER_IS_SUPERADMIN`
 * — so the caller's own id is required, not optional.
 */
export declare const listBusinesses: (http: HttpClient, auth: AuthManager) => Promise<BusinessSummary[]>;
export declare const resolveBusiness: (http: HttpClient, auth: AuthManager, name: string) => Promise<BusinessSummary>;
