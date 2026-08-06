export class TangibleApiError extends Error {
    status;
    body;
    constructor(message, status, body) {
        super(message);
        this.status = status;
        this.body = body;
        this.name = 'TangibleApiError';
    }
}
// Mirrors frontend/src/providers/authProvider.ts:150-158 — the API puts the
// human-readable reason in `message` or in the first entry of `stack`.
const errorMessage = (body, status) => {
    if (body && typeof body === 'object') {
        const b = body;
        if (typeof b.message === 'string')
            return b.message;
        if (Array.isArray(b.stack)) {
            const first = b.stack[0];
            if (typeof first?.message === 'string')
                return first.message;
        }
        if (b.stack && typeof b.stack === 'object') {
            const m = b.stack.message;
            if (typeof m === 'string')
                return m;
        }
        // Express's own 404 handler returns { status, success, error, path, method }
        // with no `message`, so an unrouted path used to surface as a bare status
        // with nothing to act on. Name the path that missed.
        const { error, path, method } = b;
        if (typeof error === 'string') {
            const where = typeof path === 'string'
                ? ` — ${typeof method === 'string' ? `${method} ` : ''}${path}`
                : '';
            return `${error}${where}`;
        }
    }
    return `Tangible API request failed with status ${status}`;
};
/**
 * Course and business ids are UUIDs, and this codebase does not surface a UUID
 * in any output — including error messages. The pattern has no anchoring to
 * path separators, so it scrubs a UUID wherever one appears: in a route
 * segment, or embedded in a backend's own free-text error message (e.g.
 * "Course <uuid> not found"). Everything else in the string — the route
 * shape, or the human-readable reason — passes through untouched.
 */
const redactIds = (text) => text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
export const createHttpClient = (baseUrl, fetchImpl = fetch) => {
    const base = baseUrl.replace(/\/+$/, '');
    return {
        async request({ method, path, body, token, query }) {
            const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
            const url = `${base}/${path.replace(/^\/+/, '')}${qs}`;
            const headers = { Accept: 'application/json' };
            if (token)
                headers.Authorization = `Bearer ${token}`;
            if (body !== undefined)
                headers['Content-Type'] = 'application/json';
            const res = await fetchImpl(url, {
                method,
                headers,
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            });
            const raw = await res.text();
            let parsed = undefined;
            try {
                parsed = raw ? JSON.parse(raw) : undefined;
            }
            catch {
                parsed = raw;
            }
            if (!res.ok) {
                throw new TangibleApiError(redactIds(errorMessage(parsed, res.status)), res.status, parsed);
            }
            // An empty body (204 and friends) legitimately carries nothing.
            if (parsed === undefined)
                return undefined;
            if (parsed !== null && typeof parsed === 'object' && 'payload' in parsed) {
                return parsed.payload;
            }
            // Previously this returned `parsed?.payload` unconditionally, so a body
            // that wasn't enveloped yielded `undefined` in silence — which then
            // travelled downstream as a missing course id and got persisted. Fail at
            // the boundary instead, and name the keys so the real shape is obvious
            // without a second round-trip.
            const got = parsed !== null && typeof parsed === 'object'
                ? `keys [${Object.keys(parsed).join(', ')}]`
                : `${typeof parsed}`;
            throw new TangibleApiError(`Unexpected response shape from ${method} ${redactIds(path)}: ` +
                `expected a "payload" envelope, got ${got}`, res.status, parsed);
        },
    };
};
