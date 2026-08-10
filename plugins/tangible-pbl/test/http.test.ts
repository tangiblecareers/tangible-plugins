import { describe, it, expect, vi } from 'vitest';
import { createHttpClient, TangibleApiError } from '../src/http.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('createHttpClient', () => {
  it('unwraps the payload envelope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ payload: { id: 'c1' } }));
    const http = createHttpClient('https://api.test/v1', fetchImpl);
    await expect(http.request({ method: 'GET', path: 'business/courses' }))
      .resolves.toEqual({ id: 'c1' });
  });

  it('joins base and path without doubling slashes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ payload: {} }));
    const http = createHttpClient('https://api.test/v1/', fetchImpl);
    await http.request({ method: 'GET', path: '/business/courses' });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.test/v1/business/courses');
  });

  it('sends the bearer token and JSON body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ payload: {} }));
    const http = createHttpClient('https://api.test/v1', fetchImpl);
    await http.request({
      method: 'POST',
      path: 'business/courses',
      token: 'tok',
      body: { prompt: 'hi' },
    });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(init.body).toBe('{"prompt":"hi"}');
  });

  it('appends query parameters', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ payload: {} }));
    const http = createHttpClient('https://api.test/v1', fetchImpl);
    await http.request({ method: 'GET', path: 'x', query: { search: 'a b' } });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.test/v1/x?search=a+b');
  });

  it('throws TangibleApiError carrying status and message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ message: 'nope' }, 403));
    const http = createHttpClient('https://api.test/v1', fetchImpl);
    const err = await http
      .request({ method: 'GET', path: 'x' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TangibleApiError);
    expect((err as TangibleApiError).status).toBe(403);
    expect((err as TangibleApiError).message).toBe('nope');
  });

  it('reads the message out of a stack array', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json({ stack: [{ message: 'deep' }] }, 422));
    const http = createHttpClient('https://api.test/v1', fetchImpl);
    await expect(http.request({ method: 'GET', path: 'x' })).rejects.toThrow('deep');
  });

  // Express's 404 handler carries `error`/`path`/`method` and NO `message`.
  // Before this, an unrouted path surfaced as a bare "failed with status 404",
  // which cost real debugging time against the live API.
  it('names the path when a route does not exist', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json(
        {
          status: 404,
          success: false,
          error: 'Not Found',
          path: '/tangible/v1/user/business',
          method: 'GET',
        },
        404,
      ),
    );
    const http = createHttpClient('https://api.test/v1', fetchImpl);
    await expect(http.request({ method: 'GET', path: 'x' })).rejects.toThrow(
      'Not Found — GET /tangible/v1/user/business',
    );
  });

  it('prefers message over error when both are present', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json({ message: 'real reason', error: 'Bad Request' }, 400));
    const http = createHttpClient('https://api.test/v1', fetchImpl);
    await expect(http.request({ method: 'GET', path: 'x' })).rejects.toThrow(
      'real reason',
    );
  });

  it('survives a non-JSON error body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('gateway down', { status: 502 }));
    const http = createHttpClient('https://api.test/v1', fetchImpl);
    await expect(http.request({ method: 'GET', path: 'x' })).rejects.toThrow(
      /502/,
    );
  });

  // Regression: the backend's own error body can embed a course/sub-unit id
  // directly in `message` — e.g. a not-found or duplicate-resource error.
  // errorMessage() returns that text verbatim, so the id must be scrubbed
  // before it ever reaches a TangibleApiError, not left to each call site.
  it('redacts a UUID embedded in the backend error message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json({ message: 'Course 8f14e45f-ceea-467a-9f0e-0d0a0d0a0d0a not found' }, 404),
    );
    const http = createHttpClient('https://api.test/v1', fetchImpl);
    const err = await http
      .request({ method: 'GET', path: 'x' })
      .catch((e: unknown) => e as TangibleApiError);
    expect(err).toBeInstanceOf(TangibleApiError);
    expect((err as TangibleApiError).message).toContain('not found');
    expect((err as TangibleApiError).message).not.toContain('8f14e45f');
  });
});

/**
 * Regression: every response was unwrapped with `parsed?.payload` and returned
 * as-is. A body that is not enveloped yielded `undefined` silently, which then
 * flowed downstream as a missing course id instead of failing at the boundary.
 */
describe('createHttpClient — response envelope', () => {
  it('throws when an object body has no payload envelope, naming the keys it did have', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ id: 'c1', title: 'Intro' }));
    const http = createHttpClient('https://api.test/v1', fetchImpl);
    const err = await http
      .request({ method: 'POST', path: 'business/courses' })
      .then(() => undefined, (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(TangibleApiError);
    expect(err!.message).toMatch(/payload/);
    expect(err!.message).toMatch(/id/);
    expect(err!.message).toMatch(/title/);
  });

  it('still returns undefined for an empty body, so 204-style responses keep working', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const http = createHttpClient('https://api.test/v1', fetchImpl);
    await expect(
      http.request({ method: 'DELETE', path: 'business/courses/x/invitations' }),
    ).resolves.toBeUndefined();
  });

  it('keeps a course UUID out of the wrong-shape error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ id: 'c1' }));
    const http = createHttpClient('https://api.test/v1', fetchImpl);
    const err = await http
      .request({
        method: 'GET',
        path: 'business/courses/8f14e45f-ceea-467a-9f0e-0d0a0d0a0d0a',
      })
      .then(() => undefined, (e: unknown) => e as Error);
    expect(err!.message).not.toContain('8f14e45f');
    // Still says which route, so the message stays actionable.
    expect(err!.message).toContain('business/courses');
  });
});
