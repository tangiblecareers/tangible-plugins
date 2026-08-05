import type { AuthManager } from './auth.js';
import type { HttpClient } from './http.js';

export interface BusinessSummary {
  id: string;
  name: string;
  role?: string;
}

/** One `usersInBusiness` row from GET user/profile/:userId. */
interface MembershipRow {
  businessId?: string;
  role?: string;
  businessUserInBusiness?: { id?: string; name?: string; logoUrl?: string | null };
}

/**
 * Business-portal roles. `business-course.route.ts` guards the whole /courses
 * group with `isBusinessEducatorOrAbove`, so an EDUCATOR can author (scoped to
 * their own courses by `scopeCoursesToCreatorIfEducator`). Mirrors the web
 * app's `isBusinessRole` — frontend/src/access/roles.ts:111.
 */
const AUTHORING_ROLES = new Set(['MANAGER', 'BUSINESS_MANAGER', 'EDUCATOR']);

/**
 * There is no endpoint that lists a user's businesses. The web app derives the
 * switcher list from the user profile's `usersInBusiness` rows
 * (frontend/src/data/user/useUserTopNav.ts), and this does the same.
 *
 * The profile only carries `usersInBusiness` when you ask for your OWN id —
 * `user.controller.ts:50` attaches it behind `USER_IS_SELF || USER_IS_SUPERADMIN`
 * — so the caller's own id is required, not optional.
 */
export const listBusinesses = async (
  http: HttpClient,
  auth: AuthManager,
): Promise<BusinessSummary[]> =>
  auth.withUser(async (token) => {
    const userId = await auth.userId();
    const payload = await http.request<{ usersInBusiness?: MembershipRow[] }>({
      method: 'GET',
      path: `user/profile/${userId}`,
      token,
    });
    return (payload?.usersInBusiness ?? [])
      .filter((m) => AUTHORING_ROLES.has((m.role ?? '').toUpperCase()))
      .map((m) => ({
        id: m.businessId ?? m.businessUserInBusiness?.id ?? '',
        name: m.businessUserInBusiness?.name ?? '',
        role: m.role,
      }))
      .filter((b) => b.id && b.name);
  });

const names = (list: BusinessSummary[]) => list.map((b) => b.name).join(', ');

export const resolveBusiness = async (
  http: HttpClient,
  auth: AuthManager,
  name: string,
): Promise<BusinessSummary> => {
  const all = await listBusinesses(http, auth);
  const needle = name.trim().toLowerCase();

  const exact = all.filter((b) => b.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0]!;

  const prefixed = all.filter((b) => b.name.toLowerCase().startsWith(needle));
  if (prefixed.length === 1) return prefixed[0]!;
  if (prefixed.length > 1) {
    throw new Error(
      `"${name}" matches more than one business: ${names(prefixed)}. Be more specific.`,
    );
  }

  throw new Error(
    `No business matching "${name}". Available: ${names(all)}`,
  );
};
