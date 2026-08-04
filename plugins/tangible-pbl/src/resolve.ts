import type { AuthManager } from './auth.js';
import type { HttpClient } from './http.js';

export interface BusinessSummary {
  id: string;
  name: string;
}

/** GET user/business — frontend/src/api/endpoints.ts:168. */
export const listBusinesses = async (
  http: HttpClient,
  auth: AuthManager,
): Promise<BusinessSummary[]> =>
  auth.withUser(async (token) => {
    const payload = await http.request<
      BusinessSummary[] | { rows?: BusinessSummary[] }
    >({ method: 'GET', path: 'user/business', token });
    if (Array.isArray(payload)) return payload;
    return payload?.rows ?? [];
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
