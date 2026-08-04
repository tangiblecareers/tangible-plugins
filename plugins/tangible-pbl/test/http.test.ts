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
});
