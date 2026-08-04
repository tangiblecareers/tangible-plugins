import type { AuthManager } from '../auth.js';
import type { HttpClient } from '../http.js';

export const call = <T>(
  http: HttpClient,
  auth: AuthManager,
  opts: Omit<Parameters<HttpClient['request']>[0], 'token'>,
): Promise<T> =>
  auth.withBusiness((token) => http.request<T>({ ...opts, token }));
