import { describe, it, expect, vi } from 'vitest';
import { listBusinesses, resolveBusiness } from '../src/resolve.js';
import { AuthManager } from '../src/auth.js';
import type { HttpClient } from '../src/http.js';

const authFor = (request: HttpClient['request']) =>
  new AuthManager({ request }, { email: 'a@b.c', password: 'pw' });

/** A `usersInBusiness` row exactly as GET user/profile/:userId returns it. */
const membership = (businessId: string, name: string, role = 'MANAGER') => ({
  businessId,
  role,
  businessUserInBusiness: { id: businessId, name, logoUrl: null },
});

const PROFILE = {
  usersInBusiness: [
    membership('b1', 'Acme Corp'),
    membership('b2', 'Globex', 'EDUCATOR'),
  ],
};

const LOGIN = { id: 'u1', token: 'u' };

const httpFor = (profile: unknown) => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(LOGIN)
    .mockResolvedValueOnce(profile);
  return { http: { request: request as never } as HttpClient, request };
};

describe('listBusinesses', () => {
  it('derives the list from the profile membership rows', async () => {
    const { http, request } = httpFor(PROFILE);
    await expect(listBusinesses(http, authFor(request as never))).resolves.toEqual([
      { id: 'b1', name: 'Acme Corp', role: 'MANAGER' },
      { id: 'b2', name: 'Globex', role: 'EDUCATOR' },
    ]);
  });

  it('requests the caller’s own profile, which is the only one carrying memberships', async () => {
    const { http, request } = httpFor(PROFILE);
    await listBusinesses(http, authFor(request as never));
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: 'GET', path: 'user/profile/u1' }),
    );
  });

  // business-course.route.ts guards /courses with isBusinessEducatorOrAbove, so
  // a membership below that cannot author and must not be offered.
  it('drops memberships whose role cannot author courses', async () => {
    const { http, request } = httpFor({
      usersInBusiness: [
        membership('b1', 'Acme Corp', 'MANAGER'),
        membership('b9', 'Learner Co', 'USER'),
      ],
    });
    const list = await listBusinesses(http, authFor(request as never));
    expect(list.map((b) => b.name)).toEqual(['Acme Corp']);
  });

  it('drops rows missing an id or a name rather than showing a blank entry', async () => {
    const { http, request } = httpFor({
      usersInBusiness: [
        membership('b1', 'Acme Corp'),
        { businessId: 'b2', role: 'MANAGER' }, // no nested business -> no name
      ],
    });
    const list = await listBusinesses(http, authFor(request as never));
    expect(list.map((b) => b.name)).toEqual(['Acme Corp']);
  });

  it('returns empty when the profile carries no memberships', async () => {
    const { http, request } = httpFor({});
    await expect(listBusinesses(http, authFor(request as never))).resolves.toEqual([]);
  });
});

describe('resolveBusiness', () => {
  const setup = () => httpFor(PROFILE);

  it('matches case-insensitively', async () => {
    const { http, request } = setup();
    await expect(
      resolveBusiness(http, authFor(request as never), 'acme corp'),
    ).resolves.toMatchObject({ id: 'b1', name: 'Acme Corp' });
  });

  it('matches on a unique prefix', async () => {
    const { http, request } = setup();
    await expect(
      resolveBusiness(http, authFor(request as never), 'glob'),
    ).resolves.toMatchObject({ id: 'b2', name: 'Globex' });
  });

  it('lists the options when the name is unknown', async () => {
    const { http, request } = setup();
    await expect(
      resolveBusiness(http, authFor(request as never), 'Initech'),
    ).rejects.toThrow(/No business matching "Initech".*Acme Corp, Globex/s);
  });

  it('refuses an ambiguous prefix rather than guessing', async () => {
    const { http, request } = httpFor({
      usersInBusiness: [
        membership('b1', 'Acme Corp'),
        membership('b3', 'Acme Labs'),
      ],
    });
    await expect(
      resolveBusiness(http, authFor(request as never), 'Acme'),
    ).rejects.toThrow(/matches more than one business.*Acme Corp, Acme Labs/s);
  });
});
