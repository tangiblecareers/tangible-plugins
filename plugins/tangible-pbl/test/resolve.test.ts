import { describe, it, expect, vi } from 'vitest';
import { listBusinesses, resolveBusiness } from '../src/resolve.js';
import { AuthManager } from '../src/auth.js';
import type { HttpClient } from '../src/http.js';

const authFor = (request: HttpClient['request']) =>
  new AuthManager({ request }, { email: 'a@b.c', password: 'pw' });

const ROWS = [
  { id: 'b1', name: 'Acme Corp' },
  { id: 'b2', name: 'Globex' },
];

describe('listBusinesses', () => {
  it('reads payload.rows', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ token: 'u' })
      .mockResolvedValueOnce({ rows: ROWS });
    const http: HttpClient = { request: request as never };
    await expect(listBusinesses(http, authFor(request as never))).resolves.toEqual(ROWS);
  });

  it('accepts a bare array payload', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ token: 'u' })
      .mockResolvedValueOnce(ROWS);
    const http: HttpClient = { request: request as never };
    await expect(listBusinesses(http, authFor(request as never))).resolves.toEqual(ROWS);
  });
});

describe('resolveBusiness', () => {
  const setup = () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ token: 'u' })
      .mockResolvedValueOnce({ rows: ROWS });
    return { http: { request: request as never } as HttpClient, request };
  };

  it('matches case-insensitively', async () => {
    const { http, request } = setup();
    await expect(resolveBusiness(http, authFor(request as never), 'acme corp'))
      .resolves.toEqual({ id: 'b1', name: 'Acme Corp' });
  });

  it('matches on a unique prefix', async () => {
    const { http, request } = setup();
    await expect(resolveBusiness(http, authFor(request as never), 'glob'))
      .resolves.toEqual({ id: 'b2', name: 'Globex' });
  });

  it('lists the options when the name is unknown', async () => {
    const { http, request } = setup();
    await expect(
      resolveBusiness(http, authFor(request as never), 'Initech'),
    ).rejects.toThrow(/No business matching "Initech".*Acme Corp, Globex/s);
  });

  it('refuses an ambiguous prefix rather than guessing', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ token: 'u' })
      .mockResolvedValueOnce({
        rows: [
          { id: 'b1', name: 'Acme Corp' },
          { id: 'b3', name: 'Acme Labs' },
        ],
      });
    const http: HttpClient = { request: request as never };
    await expect(
      resolveBusiness(http, authFor(request as never), 'Acme'),
    ).rejects.toThrow(/matches more than one business.*Acme Corp, Acme Labs/s);
  });
});
