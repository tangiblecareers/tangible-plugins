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
    }
    return `Tangible API request failed with status ${status}`;
};
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
                throw new TangibleApiError(errorMessage(parsed, res.status), res.status, parsed);
            }
            return parsed?.payload;
        },
    };
};
