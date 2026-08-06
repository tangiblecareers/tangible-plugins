import { describe, it, expect, vi } from 'vitest';
import {
  asCourse,
  createCourse, getCourse, addContext, selectContext, generateSkills, selectSkill,
  generateProblems, selectProblem, generateContentUnits, listContentUnits,
} from '../src/api/builder.js';
import { publishCourse, sendInvitations, addResource } from '../src/api/courses.js';
import { AuthManager } from '../src/auth.js';
import type { HttpClient } from '../src/http.js';

/** An auth manager already holding a business token, so calls go straight through. */
const ready = async () => {
  const request = vi.fn().mockResolvedValue({ token: 'biz', businessRole: 'ADMIN' });
  const auth = new AuthManager({ request: request as never }, { email: 'a@b.c', password: 'pw' });
  await auth.loginBusiness('b1', 'Acme');
  return auth;
};

const spyHttp = (result: unknown = { id: 'c1', status: 'INITIALIZING' }) => {
  const request = vi.fn().mockResolvedValue(result);
  return { http: { request } as unknown as HttpClient, request };
};

describe('builder', () => {
  it('createCourse posts the brief as prompt', async () => {
    const { http, request } = spyHttp({ id: 'c1', status: 'INITIALIZING' });
    await createCourse(http, await ready(), 'Teach incident response');
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: 'business/courses',
      token: 'biz',
      body: { prompt: 'Teach incident response' },
    });
  });

  it('addContext posts category and value', async () => {
    const { http, request } = spyHttp();
    await addContext(http, await ready(), 'c1', 'DURATION', '4 weeks');
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: 'business/courses/c1/course-contexts',
      token: 'biz',
      body: { category: 'DURATION', value: '4 weeks' },
    });
  });

  it('selectContext patches isSelected', async () => {
    const { http, request } = spyHttp();
    await selectContext(http, await ready(), 'c1', 'ctx1', true);
    expect(request).toHaveBeenCalledWith({
      method: 'PATCH',
      path: 'business/courses/c1/course-contexts/ctx1',
      token: 'biz',
      body: { isSelected: true },
    });
  });

  it('generateSkills posts to the generate route with an empty body', async () => {
    const { http, request } = spyHttp();
    await generateSkills(http, await ready(), 'c1');
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: 'business/courses/c1/course-skills/generate',
      token: 'biz',
      body: {},
    });
  });

  it('selectSkill patches the course skill', async () => {
    const { http, request } = spyHttp();
    await selectSkill(http, await ready(), 'c1', 'cs1', false);
    expect(request).toHaveBeenCalledWith({
      method: 'PATCH',
      path: 'business/courses/c1/course-skills/cs1',
      token: 'biz',
      body: { isSelected: false },
    });
  });

  it('generateProblems and selectProblem hit the course-problems routes', async () => {
    const { http, request } = spyHttp();
    const auth = await ready();
    await generateProblems(http, auth, 'c1');
    await selectProblem(http, auth, 'c1', 'p1', true);
    expect(request.mock.calls[0]![0]).toMatchObject({
      method: 'POST', path: 'business/courses/c1/course-problems/generate',
    });
    expect(request.mock.calls[1]![0]).toMatchObject({
      method: 'PATCH', path: 'business/courses/c1/course-problems/p1',
      body: { isSelected: true },
    });
  });

  it('generateContentUnits posts to content-units/generate', async () => {
    const { http, request } = spyHttp({ contentUnits: [{ id: 'u1', title: 'Unit 1' }] });
    const units = await generateContentUnits(http, await ready(), 'c1');
    expect(request.mock.calls[0]![0]).toMatchObject({
      method: 'POST', path: 'business/courses/c1/content-units/generate',
    });
    expect(units).toEqual([{ id: 'u1', title: 'Unit 1' }]);
  });

  it('listContentUnits tolerates a bare array payload', async () => {
    const { http } = spyHttp([{ id: 'u1', title: 'Unit 1' }]);
    await expect(listContentUnits(http, await ready(), 'c1')).resolves.toEqual([
      { id: 'u1', title: 'Unit 1' },
    ]);
  });

  it('publishCourse PATCHes the publish route', async () => {
    const { http, request } = spyHttp();
    await publishCourse(http, await ready(), 'c1');
    expect(request).toHaveBeenCalledWith({
      method: 'PATCH',
      path: 'business/courses/c1/publish',
      token: 'biz',
      body: {},
    });
  });

  it('sendInvitations posts the email list', async () => {
    const { http, request } = spyHttp();
    await sendInvitations(http, await ready(), 'c1', ['x@y.z']);
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: 'business/courses/c1/invitations',
      token: 'biz',
      body: { emails: ['x@y.z'] },
    });
  });

  it('getCourse fetches a course by id', async () => {
    const { http, request } = spyHttp({ id: 'c1', status: 'DRAFT' });
    await getCourse(http, await ready(), 'c1');
    expect(request).toHaveBeenCalledWith({
      method: 'GET',
      path: 'business/courses/c1',
      token: 'biz',
    });
  });

  it('addResource posts to the deeply nested resources endpoint', async () => {
    const { http, request } = spyHttp();
    const values = { title: 'API Docs', type: 'LINK' as const, url: 'https://docs.example.com' };
    await addResource(http, await ready(), 'c1', 'u1', 's1', values);
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: 'business/courses/c1/content-units/u1/sub-content-units/s1/resources',
      token: 'biz',
      body: values,
    });
  });
});

/**
 * Regression: a live staging run created a course whose payload was truthy but
 * carried no `id`, so `course.id` was undefined and every following call went
 * to `business/courses/undefined/...`. Three attempts died there.
 */
describe('asCourse — resolving the course id from an undocumented shape', () => {
  it('finds the id on a bare course object', () => {
    expect(asCourse({ id: 'c1', status: 'INITIALIZING' }, 'x').id).toBe('c1');
  });

  it.each([
    ['course', { course: { id: 'c1', status: 'INITIALIZING' } }],
    ['Course', { Course: { id: 'c1', status: 'INITIALIZING' } }],
    ['data', { data: { id: 'c1', status: 'INITIALIZING' } }],
    ['courseData', { courseData: { id: 'c1', status: 'INITIALIZING' } }],
  ])('finds a course nested under .%s', (_name, payload) => {
    expect(asCourse(payload, 'x').id).toBe('c1');
  });

  it.each(['courseId', 'uuid', '_id'])('accepts %s as the id field', (key) => {
    expect(asCourse({ [key]: 'c1', status: 'INITIALIZING' }, 'x').id).toBe('c1');
  });

  it('carries the rest of the course through, not just the id', () => {
    const c = asCourse(
      { course: { id: 'c1', title: 'Intro', status: 'DRAFT', CourseContexts: [{ id: 'x' }] } },
      'x',
    );
    expect(c.title).toBe('Intro');
    expect(c.status).toBe('DRAFT');
    expect(c.CourseContexts).toEqual([{ id: 'x' }]);
  });

  it('rejects an empty-string id rather than passing it downstream', () => {
    // '' is falsy but would still build `business/courses//course-contexts`.
    expect(() => asCourse({ id: '', status: 'INITIALIZING' }, 'x')).toThrow(/no course id/);
  });

  it('names the keys it actually got, nested one level, so the shape is identifiable', () => {
    const err = (() => {
      try {
        asCourse({ result: { name: 'Intro', slug: 'intro' }, meta: 1 }, 'POST business/courses');
        return undefined;
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err!.message).toContain('POST business/courses');
    // The nested map is the whole point — a flat key list would not tell you
    // where the course actually lives.
    expect(err!.message).toContain('result{name,slug}');
    expect(err!.message).toContain('meta');
  });

  it('throws on a payload that is not an object at all', () => {
    expect(() => asCourse(undefined, 'x')).toThrow(/no course id/);
    expect(() => asCourse('nope', 'x')).toThrow(/no course id/);
  });

  it('createCourse resolves a wrapped payload end to end', async () => {
    const { http } = spyHttp({ course: { id: 'c1', status: 'INITIALIZING' } });
    await expect(createCourse(http, await ready(), 'brief')).resolves.toMatchObject({ id: 'c1' });
  });

  it('createCourse throws naming the route when the id is missing', async () => {
    const { http } = spyHttp({ result: { name: 'Intro' } });
    await expect(createCourse(http, await ready(), 'brief')).rejects.toThrow(
      /POST business\/courses: no course id/,
    );
  });
});
