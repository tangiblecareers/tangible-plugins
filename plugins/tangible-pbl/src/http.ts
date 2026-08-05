export class TangibleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'TangibleApiError';
  }
}

export interface RequestOpts {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  token?: string;
  query?: Record<string, string>;
}

export interface HttpClient {
  request<T>(opts: RequestOpts): Promise<T>;
}

// Mirrors frontend/src/providers/authProvider.ts:150-158 — the API puts the
// human-readable reason in `message` or in the first entry of `stack`.
const errorMessage = (body: unknown, status: number): string => {
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; stack?: unknown };
    if (typeof b.message === 'string') return b.message;
    if (Array.isArray(b.stack)) {
      const first = b.stack[0] as { message?: unknown } | undefined;
      if (typeof first?.message === 'string') return first.message;
    }
    if (b.stack && typeof b.stack === 'object') {
      const m = (b.stack as { message?: unknown }).message;
      if (typeof m === 'string') return m;
    }
    // Express's own 404 handler returns { status, success, error, path, method }
    // with no `message`, so an unrouted path used to surface as a bare status
    // with nothing to act on. Name the path that missed.
    const { error, path, method } = b as {
      error?: unknown;
      path?: unknown;
      method?: unknown;
    };
    if (typeof error === 'string') {
      const where =
        typeof path === 'string'
          ? ` — ${typeof method === 'string' ? `${method} ` : ''}${path}`
          : '';
      return `${error}${where}`;
    }
  }
  return `Tangible API request failed with status ${status}`;
};

/**
 * Course and business ids are UUIDs, and this codebase does not surface a UUID
 * in any output — including error messages. Route shape is still useful, so
 * keep the path and replace only the id segments.
 */
const redactIds = (path: string): string =>
  path.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ':id',
  );

export const createHttpClient = (
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): HttpClient => {
  const base = baseUrl.replace(/\/+$/, '');

  return {
    async request<T>({ method, path, body, token, query }: RequestOpts): Promise<T> {
      const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
      const url = `${base}/${path.replace(/^\/+/, '')}${qs}`;

      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      const res = await fetchImpl(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

      const raw = await res.text();
      let parsed: unknown = undefined;
      try {
        parsed = raw ? JSON.parse(raw) : undefined;
      } catch {
        parsed = raw;
      }

      if (!res.ok) {
        throw new TangibleApiError(errorMessage(parsed, res.status), res.status, parsed);
      }

      // An empty body (204 and friends) legitimately carries nothing.
      if (parsed === undefined) return undefined as T;

      if (parsed !== null && typeof parsed === 'object' && 'payload' in parsed) {
        return (parsed as { payload: T }).payload;
      }

      // Previously this returned `parsed?.payload` unconditionally, so a body
      // that wasn't enveloped yielded `undefined` in silence — which then
      // travelled downstream as a missing course id and got persisted. Fail at
      // the boundary instead, and name the keys so the real shape is obvious
      // without a second round-trip.
      const got =
        parsed !== null && typeof parsed === 'object'
          ? `keys [${Object.keys(parsed).join(', ')}]`
          : `${typeof parsed}`;
      throw new TangibleApiError(
        `Unexpected response shape from ${method} ${redactIds(path)}: ` +
          `expected a "payload" envelope, got ${got}`,
        res.status,
        parsed,
      );
    },
  };
};
