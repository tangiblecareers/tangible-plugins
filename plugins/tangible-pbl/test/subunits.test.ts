import { describe, it, expect, vi } from 'vitest';
import {
  createSubUnit, listSubUnits, assignSkill, generateArtifact,
} from '../src/api/subunits.js';
import { AuthManager } from '../src/auth.js';
import type { HttpClient } from '../src/http.js';

/** An auth manager already holding a business token, so calls go straight through. */
const ready = async () => {
  const request = vi.fn().mockResolvedValue({ token: 'biz', businessRole: 'ADMIN' });
  const auth = new AuthManager({ request } as unknown as HttpClient, {
    email: 'a@b.c', password: 'pw',
  });
  await auth.loginBusiness('b1', 'Acme');
  return auth;
};

const spyHttp = (result: unknown = {}) => {
  const request = vi.fn().mockResolvedValue(result);
  return { http: { request } as unknown as HttpClient, request };
};

describe('subunits api', () => {
  it('createSubUnit posts title, description and estimatedDuration', async () => {
    const { http, request } = spyHttp({ id: 'su1', title: 'Intro' });
    await createSubUnit(http, await ready(), 'c1', 'cu1', {
      title: 'Intro', description: 'why', estimatedDuration: 45,
    });
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: 'business/courses/c1/content-units/cu1/sub-content-units',
      token: 'biz',
      body: { title: 'Intro', description: 'why', estimatedDuration: 45 },
    });
  });

  it('createSubUnit omits absent optional fields rather than sending null', async () => {
    const { http, request } = spyHttp({ id: 'su1', title: 'Intro' });
    await createSubUnit(http, await ready(), 'c1', 'cu1', { title: 'Intro' });
    expect(request.mock.calls[0]![0].body).toStrictEqual({ title: 'Intro' });
  });

  it('listSubUnits tolerates a bare array payload', async () => {
    const { http } = spyHttp([{ id: 'su1', title: 'Intro' }]);
    await expect(listSubUnits(http, await ready(), 'c1', 'cu1'))
      .resolves.toEqual([{ id: 'su1', title: 'Intro' }]);
  });

  it('listSubUnits tolerates a keyed payload', async () => {
    const { http } = spyHttp({ subContentUnits: [{ id: 'su1', title: 'Intro' }] });
    await expect(listSubUnits(http, await ready(), 'c1', 'cu1'))
      .resolves.toEqual([{ id: 'su1', title: 'Intro' }]);
  });

  it('listSubUnits returns [] for an unrecognised payload rather than throwing', async () => {
    const { http } = spyHttp({ nope: 1 });
    await expect(listSubUnits(http, await ready(), 'c1', 'cu1')).resolves.toEqual([]);
  });

  it('assignSkill posts both ids to the skills route', async () => {
    const { http, request } = spyHttp({});
    await assignSkill(http, await ready(), 'c1', 'cu1', 'su1', {
      coreCompetencyModelId: 'ccm1', levelId: 'lvl1',
    });
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: 'business/courses/c1/content-units/cu1/sub-content-units/su1/skills',
      token: 'biz',
      body: { coreCompetencyModelId: 'ccm1', levelId: 'lvl1' },
    });
  });

  it('generateArtifact posts to the generate route with an empty body by default', async () => {
    const { http, request } = spyHttp({});
    await generateArtifact(http, await ready(), 'c1', 'cu1', 'su1');
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: 'business/courses/c1/content-units/cu1/sub-content-units/su1/artifact/generate',
      token: 'biz',
      body: {},
    });
  });

  it('generateArtifact passes an instruction when given', async () => {
    const { http, request } = spyHttp({});
    await generateArtifact(http, await ready(), 'c1', 'cu1', 'su1', {
      instruction: 'keep it practical',
    });
    expect(request.mock.calls[0]![0].body).toEqual({ instruction: 'keep it practical' });
  });
});
