import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createRuntime, switchEnvironment, type Runtime } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { AuthManager } from '../src/auth.js';
import { CourseMemoryStore, type CourseMemory } from '../src/session/memory.js';
import { reconcile } from '../src/session/reconcile.js';
import { registerSessionTools } from '../src/tools/session.js';
import { registerDirectTools } from '../src/tools/direct.js';
import type { HttpClient, RequestOpts } from '../src/http.js';

const CFG = loadConfig({
  TANGIBLE_ENV: 'staging',
  TANGIBLE_STAGING_API_URL: 'https://stage.test/v1',
  TANGIBLE_STAGING_APP_URL: 'https://stage.app',
  TANGIBLE_STAGING_EMAIL: 's@x.y',
  TANGIBLE_STAGING_PASSWORD: 'sp',
  TANGIBLE_PRODUCTION_API_URL: 'https://prod.test/v1',
  TANGIBLE_PRODUCTION_APP_URL: 'https://prod.app',
  TANGIBLE_PRODUCTION_EMAIL: 'p@x.y',
  TANGIBLE_PRODUCTION_PASSWORD: 'pp',
});

describe('createRuntime', () => {
  it('builds a runtime for the active environment', () => {
    const rt = createRuntime(CFG);
    expect(rt.env).toBe('staging');
  });
});

describe('switchEnvironment', () => {
  it('drops auth state when switching', async () => {
    const rt = createRuntime(CFG);
    await rt.auth.loginBusiness('b1', 'Acme').catch(() => undefined);
    const next = switchEnvironment(rt, 'production');
    expect(next.env).toBe('production');
    expect(next.auth.context()).toBeUndefined();
  });

  it('refuses to switch while a session is active', () => {
    const rt = { ...createRuntime(CFG), activeSessionId: 's1' };
    expect(() => switchEnvironment(rt, 'production')).toThrow(
      /session s1 is open.*pbl_abort/s,
    );
  });

  it('is a no-op returning the same environment when already there', () => {
    const rt = createRuntime(CFG);
    expect(switchEnvironment(rt, 'staging').env).toBe('staging');
  });
});

/**
 * Registers a tool module against a real McpServer but intercepts `.tool(...)`
 * to capture each callback by name, so tests can invoke the exact registered
 * handler directly — same code path as production, without standing up a
 * client/transport pair or fighting zod-schema validation in the test.
 */
const captureHandlers = (
  register: (server: McpServer, rt: { current: Runtime }) => void,
  rt: { current: Runtime },
): Map<string, (...args: any[]) => any> => {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, (...args: any[]) => any>();
  (server as unknown as { tool: (...a: unknown[]) => unknown }).tool = (
    ...args: unknown[]
  ) => {
    const name = args[0] as string;
    const cb = args[args.length - 1] as (...a: any[]) => any;
    handlers.set(name, cb);
    return undefined;
  };
  register(server, rt);
  return handlers;
};

interface FakeContext {
  id: string;
  category: 'DURATION' | 'LEARNING_OUTCOME' | 'LEARNER_PROFILE';
  value: string;
  isSelected: boolean;
}

/**
 * A fake HttpClient for a single course `c1` that mirrors the backend
 * contracts documented in business-course-context.api.yaml: contexts are
 * created un-selected, and selecting a DURATION context deselects any other
 * selected DURATION context (server-enforced single-select) — everything
 * else accumulates.
 */
const buildFakeHttp = (courseId: string) => {
  const calls: RequestOpts[] = [];
  const contexts: FakeContext[] = [];
  let nextId = 1;

  const http: HttpClient = {
    async request<T>(opts: RequestOpts): Promise<T> {
      calls.push(opts);

      if (opts.path === 'auth/login') return { token: 'user' } as T;
      if (opts.path === 'auth/business/login') {
        return { token: 'biz', businessRole: 'ADMIN' } as T;
      }

      if (opts.method === 'POST' && opts.path === `business/courses/${courseId}/course-contexts`) {
        const body = opts.body as { category: FakeContext['category']; value: string };
        const created: FakeContext = {
          id: `ctx${nextId++}`,
          category: body.category,
          value: body.value,
          isSelected: false,
        };
        contexts.push(created);
        return { id: courseId, status: 'INITIALIZING', CourseContexts: [...contexts] } as T;
      }

      const patchMatch = /^business\/courses\/[^/]+\/course-contexts\/(.+)$/.exec(opts.path);
      if (opts.method === 'PATCH' && patchMatch) {
        const id = patchMatch[1]!;
        const body = opts.body as { isSelected: boolean };
        const target = contexts.find((c) => c.id === id);
        if (target) {
          if (target.category === 'DURATION' && body.isSelected) {
            for (const other of contexts) {
              if (other.category === 'DURATION') other.isSelected = false;
            }
          }
          target.isSelected = body.isSelected;
        }
        return { id: courseId, status: 'INITIALIZING', CourseContexts: [...contexts] } as T;
      }

      if (opts.method === 'POST' && opts.path === `business/courses/${courseId}/course-skills/generate`) {
        return { id: courseId, status: 'INITIALIZING', CourseSkills: [] } as T;
      }

      if (opts.method === 'POST' && opts.path === 'business/courses') {
        return { id: courseId, status: 'INITIALIZING' } as T;
      }

      if (opts.method === 'GET' && opts.path === `business/courses/${courseId}`) {
        return { id: courseId, status: 'INITIALIZING', CourseContexts: [...contexts] } as T;
      }

      throw new Error(`fake http: unexpected request ${opts.method} ${opts.path}`);
    },
  };

  return { http, calls, contexts };
};

const makeRuntime = async (http: HttpClient, storeRoot: string): Promise<Runtime> => {
  const auth = new AuthManager(http, { email: 'a@b.c', password: 'pw' });
  await auth.loginBusiness('b1', 'Acme');
  return {
    cfg: CFG,
    env: 'staging',
    appUrl: 'https://stage.app',
    http,
    auth,
    store: new CourseMemoryStore(storeRoot),
  };
};

describe('pbl_revise — context step with new contexts', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pbl-mcp-revise-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const seedSession = async (store: CourseMemoryStore): Promise<void> => {
    const now = new Date().toISOString();
    const state: CourseMemory = {
      id: 's1',
      title: 'a brief',
      env: 'staging',
      courseId: 'c1',
      businessName: 'Acme',
      brief: 'a brief',
      step: 'skills',
      awaitingApproval: true,
      status: 'active',
      created: now,
      updated: now,
    };
    await store.save(state);
  };

  it('applies contexts and selects them before the rewound advance regenerates skills', async () => {
    const { http, calls } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedSession(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_revise')!({
      sessionId: 's1',
      step: 'context',
      contexts: [{ category: 'LEARNING_OUTCOME', value: 'Handle a live incident' }],
    });

    const paths = calls.map((c) => `${c.method} ${c.path}`);
    const addIdx = paths.indexOf('POST business/courses/c1/course-contexts');
    const selectIdx = paths.findIndex((p) => p.startsWith('PATCH business/courses/c1/course-contexts/'));
    const genIdx = paths.indexOf('POST business/courses/c1/course-skills/generate');

    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(selectIdx).toBeGreaterThan(addIdx);
    expect(genIdx).toBeGreaterThan(selectIdx);
  });

  it('selects the newly-added context so skills generation would not 422 on an unselected context', async () => {
    const { http, contexts } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedSession(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_revise')!({
      sessionId: 's1',
      step: 'context',
      contexts: [{ category: 'LEARNING_OUTCOME', value: 'Handle a live incident' }],
    });

    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.isSelected).toBe(true);
  });

  it('accumulates: adding a LEARNING_OUTCOME/LEARNER_PROFILE context leaves prior selections of that category selected', async () => {
    const { http, contexts } = buildFakeHttp('c1');
    contexts.push({ id: 'ctx0', category: 'LEARNER_PROFILE', value: 'New hires', isSelected: true });
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedSession(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_revise')!({
      sessionId: 's1',
      step: 'context',
      contexts: [{ category: 'LEARNING_OUTCOME', value: 'Handle a live incident' }],
    });

    expect(contexts.find((c) => c.id === 'ctx0')!.isSelected).toBe(true);
    expect(contexts.find((c) => c.category === 'LEARNING_OUTCOME')!.isSelected).toBe(true);
  });

  it('replaces: adding a DURATION context deselects the previous DURATION selection (server-enforced)', async () => {
    const { http, contexts } = buildFakeHttp('c1');
    contexts.push({ id: 'dur0', category: 'DURATION', value: '2 weeks', isSelected: true });
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedSession(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_revise')!({
      sessionId: 's1',
      step: 'context',
      contexts: [{ category: 'DURATION', value: '4 weeks' }],
    });

    expect(contexts.find((c) => c.id === 'dur0')!.isSelected).toBe(false);
    expect(contexts.find((c) => c.category === 'DURATION' && c.value === '4 weeks')!.isSelected).toBe(true);
  });

  it('without a contexts field, behaves exactly as before: no context calls, skills still regenerate', async () => {
    const { http, calls } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedSession(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_revise')!({ sessionId: 's1', step: 'context' });

    expect(calls.some((c) => c.path.endsWith('/course-contexts'))).toBe(false);
    expect(calls.some((c) => /course-contexts\//.test(c.path))).toBe(false);
    expect(calls.some((c) => c.path === 'business/courses/c1/course-skills/generate')).toBe(true);
  });

  it('echoes the client-supplied progress token through revise, never an invented one', async () => {
    const { http } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedSession(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);
    const sendNotification = vi.fn().mockResolvedValue(undefined);

    await handlers.get('pbl_revise')!(
      { sessionId: 's1', step: 'context' },
      { sendNotification, _meta: { progressToken: 'client-tok-42' } },
    );

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'notifications/progress',
        // The session id is 's1' — the token below must be echoed from
        // _meta, not derived from the session id, and must NOT equal it.
        params: expect.objectContaining({ progressToken: 'client-tok-42' }),
      }),
    );
  });

  it('sends no progress notification through revise when the client did not request one', async () => {
    const { http } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedSession(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);
    const sendNotification = vi.fn().mockResolvedValue(undefined);

    await handlers.get('pbl_revise')!(
      { sessionId: 's1', step: 'context' },
      { sendNotification },
    );

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('resolves the newly-created context deterministically even when an identical unselected category+value already exists', async () => {
    const { http, contexts } = buildFakeHttp('c1');
    // A pre-existing unselected context with the exact category+value we're
    // about to add — the old heuristic (reverse-find by category+value+
    // !isSelected) would have matched this one just as readily as the new one.
    contexts.push({
      id: 'ctx0', category: 'LEARNING_OUTCOME', value: 'Handle a live incident', isSelected: false,
    });
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedSession(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_revise')!({
      sessionId: 's1',
      step: 'context',
      contexts: [{ category: 'LEARNING_OUTCOME', value: 'Handle a live incident' }],
    });

    expect(contexts).toHaveLength(2);
    const preExisting = contexts.find((c) => c.id === 'ctx0')!;
    const created = contexts.find((c) => c.id !== 'ctx0')!;
    expect(preExisting.isSelected).toBe(false);
    expect(created.isSelected).toBe(true);
  });

  it('unions newly-seen context ids across calls instead of replacing, so a call whose response omits older ids does not corrupt the next lookup', async () => {
    // Regression for the "replace" bug: the first addContext response omits
    // the pre-existing seed context (an API quirk not otherwise reproducible
    // via buildFakeHttp, which always echoes the full growing list) — if
    // `known` were replaced rather than unioned, the second call's `created`
    // lookup would find the ARBITRARY pre-existing "seed1" context instead
    // of the genuinely new "ctxB", and select the wrong one.
    const calls: RequestOpts[] = [];
    let addCalls = 0;
    const http: HttpClient = {
      async request<T>(opts: RequestOpts): Promise<T> {
        calls.push(opts);
        if (opts.path === 'auth/login') return { token: 'user' } as T;
        if (opts.path === 'auth/business/login') {
          return { token: 'biz', businessRole: 'ADMIN' } as T;
        }
        if (opts.method === 'GET' && opts.path === 'business/courses/c1') {
          return {
            id: 'c1',
            status: 'INITIALIZING',
            CourseContexts: [
              { id: 'seed1', category: 'LEARNING_OUTCOME', value: 'existing', isSelected: true },
            ],
          } as T;
        }
        if (opts.method === 'POST' && opts.path === 'business/courses/c1/course-contexts') {
          addCalls += 1;
          if (addCalls === 1) {
            // Anomalous response: omits the pre-existing seed context.
            return {
              id: 'c1',
              status: 'INITIALIZING',
              CourseContexts: [
                { id: 'ctxA', category: 'LEARNING_OUTCOME', value: 'A', isSelected: false },
              ],
            } as T;
          }
          return {
            id: 'c1',
            status: 'INITIALIZING',
            CourseContexts: [
              { id: 'seed1', category: 'LEARNING_OUTCOME', value: 'existing', isSelected: true },
              { id: 'ctxA', category: 'LEARNING_OUTCOME', value: 'A', isSelected: false },
              { id: 'ctxB', category: 'LEARNING_OUTCOME', value: 'B', isSelected: false },
            ],
          } as T;
        }
        if (
          opts.method === 'PATCH' &&
          /^business\/courses\/c1\/course-contexts\/.+$/.test(opts.path)
        ) {
          return { id: 'c1', status: 'INITIALIZING', CourseContexts: [] } as T;
        }
        if (opts.method === 'POST' && opts.path === 'business/courses/c1/course-skills/generate') {
          return { id: 'c1', status: 'INITIALIZING', CourseSkills: [] } as T;
        }
        throw new Error(`fake http: unexpected request ${opts.method} ${opts.path}`);
      },
    };
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedSession(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_revise')!({
      sessionId: 's1',
      step: 'context',
      contexts: [
        { category: 'LEARNING_OUTCOME', value: 'A' },
        { category: 'LEARNING_OUTCOME', value: 'B' },
      ],
    });

    const patchedIds = calls
      .filter((c) => c.method === 'PATCH')
      .map((c) => /course-contexts\/(.+)$/.exec(c.path)?.[1]);
    expect(patchedIds).toEqual(['ctxA', 'ctxB']);
    expect(patchedIds).not.toContain('seed1');
  });

  it('throws instead of silently skipping selection when addContext response omits the created context', async () => {
    const http: HttpClient = {
      async request<T>(opts: RequestOpts): Promise<T> {
        if (opts.path === 'auth/login') return { token: 'user' } as T;
        if (opts.path === 'auth/business/login') {
          return { token: 'biz', businessRole: 'ADMIN' } as T;
        }
        if (opts.method === 'GET' && opts.path === 'business/courses/c1') {
          return { id: 'c1', status: 'INITIALIZING', CourseContexts: [] } as T;
        }
        if (opts.method === 'POST' && opts.path === 'business/courses/c1/course-contexts') {
          // API contract violation: the created context is missing from the
          // response entirely.
          return { id: 'c1', status: 'INITIALIZING', CourseContexts: [] } as T;
        }
        throw new Error(`fake http: unexpected request ${opts.method} ${opts.path}`);
      },
    };
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedSession(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await expect(
      handlers.get('pbl_revise')!({
        sessionId: 's1',
        step: 'context',
        contexts: [{ category: 'LEARNING_OUTCOME', value: 'A' }],
      }),
    ).rejects.toThrow(/did not return the new context/);
  });
});

describe('pbl_start_course — context selection', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pbl-mcp-start-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('selects each context it creates, verified by ordering (fixes the same bug as pbl_revise)', async () => {
    const { http, calls } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_start_course')!({
      brief: 'Teach incident response',
      contexts: [{ category: 'LEARNING_OUTCOME', value: 'Handle a live incident' }],
    });

    const paths = calls.map((c) => `${c.method} ${c.path}`);
    const addIdx = paths.indexOf('POST business/courses/c1/course-contexts');
    const selectIdx = paths.findIndex((p) => p.startsWith('PATCH business/courses/c1/course-contexts/'));

    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(selectIdx).toBeGreaterThan(addIdx);
    // A freshly-created course has no contexts yet, so applyContexts should
    // use createCourse's own (empty) response instead of an extra GET fetch.
    expect(calls.some((c) => c.method === 'GET')).toBe(false);
  });

  it('selects every context, not just the first, across multiple items', async () => {
    const { http, contexts } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_start_course')!({
      brief: 'Teach incident response',
      contexts: [
        { category: 'LEARNING_OUTCOME', value: 'Handle a live incident' },
        { category: 'LEARNER_PROFILE', value: 'New hires' },
      ],
    });

    expect(contexts).toHaveLength(2);
    expect(contexts.every((c) => c.isSelected)).toBe(true);
  });

  it('without contexts, creates no context calls (backward compatible)', async () => {
    const { http, calls } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_start_course')!({ brief: 'Teach incident response' });

    expect(calls.some((c) => /course-contexts/.test(c.path))).toBe(false);
  });

  it('writes zero log entries — "reads never write" starts from a clean record', async () => {
    const { http } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_start_course')!({ brief: 'Teach incident response' });

    const text = await readFile(join(root, 'staging', 'teach-incident-response.md'), 'utf8');
    const entryCount = (text.match(/^### \d{2}:\d{2} · /gm) ?? []).length;
    expect(entryCount).toBe(0);
  });
});

describe('pbl_start_course / pbl_revise — grouped CourseContexts (Object.groupBy backend shape)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pbl-mcp-grouped-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /**
   * Mirrors the real backend, not buildFakeHttp above: every course-returning
   * handler runs `Object.groupBy(contexts, c => c.category)` before
   * responding, so `CourseContexts` here is always a category-keyed object,
   * never a bare array — the exact shape that used to crash `seed.map` in
   * applyContexts before asCourse started flattening it.
   */
  const buildGroupedHttp = (courseId: string, seeded: FakeContext[] = []) => {
    const calls: RequestOpts[] = [];
    const contexts: FakeContext[] = [...seeded];
    let nextId = 1;
    // Groups in first-appearance order, same as Object.groupBy would from
    // `contexts` ordered createdAt ASC — mirroring the real wire shape,
    // not engineering the test to match the implementation.
    const grouped = (): Record<string, FakeContext[]> => {
      const byCategory: Record<string, FakeContext[]> = {};
      for (const c of contexts) {
        (byCategory[c.category] ??= []).push(c);
      }
      return byCategory;
    };

    const http: HttpClient = {
      async request<T>(opts: RequestOpts): Promise<T> {
        calls.push(opts);
        if (opts.path === 'auth/login') return { token: 'user' } as T;
        if (opts.path === 'auth/business/login') {
          return { token: 'biz', businessRole: 'ADMIN' } as T;
        }
        if (opts.method === 'POST' && opts.path === 'business/courses') {
          return { id: courseId, status: 'INITIALIZING', CourseContexts: grouped() } as T;
        }
        if (opts.method === 'GET' && opts.path === `business/courses/${courseId}`) {
          return { id: courseId, status: 'INITIALIZING', CourseContexts: grouped() } as T;
        }
        if (opts.method === 'POST' && opts.path === `business/courses/${courseId}/course-contexts`) {
          const body = opts.body as { category: FakeContext['category']; value: string };
          contexts.push({
            id: `ctx${nextId++}`, category: body.category, value: body.value, isSelected: false,
          });
          return { id: courseId, status: 'INITIALIZING', CourseContexts: grouped() } as T;
        }
        const patchMatch = /^business\/courses\/[^/]+\/course-contexts\/(.+)$/.exec(opts.path);
        if (opts.method === 'PATCH' && patchMatch) {
          const id = patchMatch[1]!;
          const body = opts.body as { isSelected: boolean };
          const target = contexts.find((c) => c.id === id);
          if (target) target.isSelected = body.isSelected;
          return { id: courseId, status: 'INITIALIZING', CourseContexts: grouped() } as T;
        }
        if (opts.method === 'POST' && opts.path === `business/courses/${courseId}/course-skills/generate`) {
          return { id: courseId, status: 'INITIALIZING', CourseSkills: [] } as T;
        }
        throw new Error(`fake http: unexpected request ${opts.method} ${opts.path}`);
      },
    };
    return { http, calls, contexts };
  };

  it('pbl_start_course succeeds with a non-empty contexts array against a grouped-shape fixture', async () => {
    const { http, calls } = buildGroupedHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await expect(
      handlers.get('pbl_start_course')!({
        brief: 'Teach incident response',
        contexts: [{ category: 'LEARNING_OUTCOME', value: 'Handle a live incident' }],
      }),
    ).resolves.toBeDefined();

    const paths = calls.map((c) => `${c.method} ${c.path}`);
    expect(paths).toContain('POST business/courses/c1/course-contexts');
    expect(paths.some((p) => p.startsWith('PATCH business/courses/c1/course-contexts/'))).toBe(true);
  });

  it('pbl_revise succeeds with a non-empty contexts array against a grouped-shape fixture', async () => {
    const { http, calls } = buildGroupedHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    const now = new Date().toISOString();
    await rtHolder.current.store.save({
      id: 's1',
      title: 'a brief',
      env: 'staging',
      courseId: 'c1',
      businessName: 'Acme',
      brief: 'a brief',
      step: 'skills',
      awaitingApproval: true,
      status: 'active',
      created: now,
      updated: now,
    });
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await expect(
      handlers.get('pbl_revise')!({
        sessionId: 's1',
        step: 'context',
        contexts: [{ category: 'LEARNING_OUTCOME', value: 'Handle a live incident' }],
      }),
    ).resolves.toBeDefined();

    const paths = calls.map((c) => `${c.method} ${c.path}`);
    expect(paths).toContain('POST business/courses/c1/course-contexts');
    expect(paths.some((p) => p.startsWith('PATCH business/courses/c1/course-contexts/'))).toBe(true);
  });

  it('the one that matters most: does not silently select a pre-existing AI-generated context instead of the one just created', async () => {
    // Reproduces the real shape: the backend already bulk-inserted
    // AI-generated contexts (some already isSelected) into the course before
    // the client ever calls addContext (see CLAUDE.md item 2). `grouped()`
    // flattens in key order DURATION, LEARNING_OUTCOME — so both
    // pre-existing AI contexts sort BEFORE the newly-added one in `all`. A
    // naive fix that defaults a non-array CourseContexts straight to `[]`
    // (instead of flattening it) would leave `known` empty here, and
    // `all.find((cc) => !known.has(cc.id))` would then match the FIRST
    // item — an existing AI context — instead of the one just created. This
    // test fails on the wrong assertion (wrong id patched) under that naive
    // fix; it does not merely fail to run.
    const preExisting: FakeContext[] = [
      { id: 'ai-dur', category: 'DURATION', value: '4 weeks', isSelected: true },
      { id: 'ai-lo', category: 'LEARNING_OUTCOME', value: 'Existing outcome', isSelected: true },
    ];
    const { http, calls, contexts } = buildGroupedHttp('c1', preExisting);
    const rtHolder = { current: await makeRuntime(http, root) };
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_start_course')!({
      brief: 'Teach incident response',
      contexts: [{ category: 'LEARNING_OUTCOME', value: 'Handle a live incident' }],
    });

    const created = contexts.find((c) => c.value === 'Handle a live incident')!;
    expect(created.id).not.toBe('ai-dur');
    expect(created.id).not.toBe('ai-lo');

    const patchCalls = calls.filter(
      (c) => c.method === 'PATCH' && /course-contexts\//.test(c.path),
    );
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0]!.path).toBe(`business/courses/c1/course-contexts/${created.id}`);

    // Pre-existing AI contexts must be untouched by this flow.
    expect(contexts.find((c) => c.id === 'ai-dur')!.isSelected).toBe(true);
    expect(contexts.find((c) => c.id === 'ai-lo')!.isSelected).toBe(true);
    expect(created.isSelected).toBe(true);
  });
});

describe('pbl_approve — progress notifications', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pbl-mcp-approve-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const seedAtContext = async (store: CourseMemoryStore): Promise<void> => {
    const now = new Date().toISOString();
    const state: CourseMemory = {
      id: 's1',
      title: 'a brief',
      env: 'staging',
      courseId: 'c1',
      businessName: 'Acme',
      brief: 'a brief',
      step: 'context',
      awaitingApproval: true,
      status: 'active',
      created: now,
      updated: now,
    };
    await store.save(state);
  };

  it('echoes the client-supplied progress token through approve, never the session id', async () => {
    const { http } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedAtContext(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);
    const sendNotification = vi.fn().mockResolvedValue(undefined);

    await handlers.get('pbl_approve')!(
      { sessionId: 's1' },
      { sendNotification, _meta: { progressToken: 7 } },
    );

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'notifications/progress',
        params: expect.objectContaining({ progressToken: 7 }),
      }),
    );
  });

  it('sends no progress notification through approve when the client did not request one', async () => {
    const { http } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedAtContext(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);
    const sendNotification = vi.fn().mockResolvedValue(undefined);

    await handlers.get('pbl_approve')!({ sessionId: 's1' }, { sendNotification });

    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe('pbl_approve — course log entry', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pbl-mcp-approve-log-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const seedAtContext = async (store: CourseMemoryStore): Promise<void> => {
    const now = new Date().toISOString();
    const state: CourseMemory = {
      id: 's1',
      title: 'a brief',
      env: 'staging',
      courseId: 'c1',
      businessName: 'Acme',
      brief: 'a brief',
      step: 'context',
      awaitingApproval: true,
      status: 'active',
      created: now,
      updated: now,
    };
    await store.save(state);
  };

  it('writes exactly one log entry recording what was produced', async () => {
    const { http } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedAtContext(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_approve')!({ sessionId: 's1' });

    const file = join(root, 'staging', 's1.md');
    const text = await readFile(file, 'utf8');
    const entryCount = (text.match(/^### \d{2}:\d{2} · /gm) ?? []).length;
    expect(entryCount).toBe(1);
    expect(text).toMatch(/### \d{2}:\d{2} · skills — approved/);
  });
});

describe('pbl_approve — records the human decision, not just the generation output', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pbl-mcp-approve-decision-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const seedAt = async (store: CourseMemoryStore, step: CourseMemory['step']): Promise<void> => {
    const now = new Date().toISOString();
    const state: CourseMemory = {
      id: 's1',
      title: 'a course',
      env: 'staging',
      courseId: 'c1',
      businessName: 'Acme',
      brief: 'a brief',
      step,
      awaitingApproval: true,
      status: 'active',
      created: now,
      updated: now,
    };
    await store.save(state);
  };

  it('logs "Kept skills: ..." from the human-supplied selectSkills, not the AI recommendation', async () => {
    const http: HttpClient = {
      async request<T>(opts: RequestOpts): Promise<T> {
        if (opts.path === 'auth/login') return { token: 'user' } as T;
        if (opts.path === 'auth/business/login') return { token: 'biz', businessRole: 'ADMIN' } as T;
        if (opts.method === 'GET' && opts.path === 'business/courses/c1') {
          return {
            id: 'c1', status: 'INITIALIZING',
            CourseSkills: [
              { id: 'cs1', isSelected: true, CoreCompetencyModel: { id: 'm1', name: 'Systems Mapping' } },
              { id: 'cs2', isSelected: true, CoreCompetencyModel: { id: 'm2', name: 'Feedback Loops' } },
            ],
          } as T;
        }
        if (opts.method === 'PATCH' && /course-skills\//.test(opts.path)) {
          return { id: 'c1', status: 'INITIALIZING' } as T;
        }
        if (opts.method === 'POST' && opts.path === 'business/courses/c1/course-problems/generate') {
          return { id: 'c1', status: 'INITIALIZING', CourseProblems: [] } as T;
        }
        throw new Error(`fake http: unexpected request ${opts.method} ${opts.path}`);
      },
    };
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedAt(rtHolder.current.store, 'skills');
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_approve')!({ sessionId: 's1', selectSkills: ['Systems Mapping'] });

    const text = await readFile(join(root, 'staging', 's1.md'), 'utf8');
    expect(text).toContain('Kept skills: Systems Mapping');
    // The line must come from the human's input, not the AI's isSelected flag
    // — both fixture skills are isSelected: true, but only one was requested.
    expect(text).not.toContain('Feedback Loops');
  });

  it('logs "Chose problem: ..." using the exact string the human passed, never an id', async () => {
    const http: HttpClient = {
      async request<T>(opts: RequestOpts): Promise<T> {
        if (opts.path === 'auth/login') return { token: 'user' } as T;
        if (opts.path === 'auth/business/login') return { token: 'biz', businessRole: 'ADMIN' } as T;
        if (opts.method === 'GET' && opts.path === 'business/courses/c1') {
          return {
            id: 'c1', status: 'INITIALIZING',
            CourseProblems: [{ id: 'p1', title: 'Municipal water shortage', isSelected: false }],
          } as T;
        }
        if (opts.method === 'PATCH' && /course-problems\//.test(opts.path)) {
          return { id: 'c1', status: 'INITIALIZING' } as T;
        }
        if (opts.method === 'POST' && opts.path === 'business/courses/c1/content-units/generate') {
          return [] as T;
        }
        throw new Error(`fake http: unexpected request ${opts.method} ${opts.path}`);
      },
    };
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedAt(rtHolder.current.store, 'problems');
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_approve')!({ sessionId: 's1', selectProblem: 'Municipal water shortage' });

    const text = await readFile(join(root, 'staging', 's1.md'), 'utf8');
    expect(text).toContain('Chose problem: "Municipal water shortage"');
    expect(text).not.toContain('p1');
  });

  it('logs neither decision line when approving a gate with no selection input', async () => {
    const { http } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedAt(rtHolder.current.store, 'context');
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_approve')!({ sessionId: 's1' });

    const text = await readFile(join(root, 'staging', 's1.md'), 'utf8');
    expect(text).not.toContain('Kept skills:');
    expect(text).not.toContain('Chose problem:');
  });
});

describe('pbl_approve — publish gate sets status', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pbl-mcp-approve-publish-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // Seeded one step short of publish. STEP_ORDER inserted 'artifacts' between
  // 'detail' and 'publish' (see machine.ts) — 'artifacts' is now that spot.
  const seedAtArtifacts = async (store: CourseMemoryStore): Promise<void> => {
    const now = new Date().toISOString();
    const state: CourseMemory = {
      id: 's1',
      title: 'a course',
      env: 'staging',
      courseId: 'c1',
      businessName: 'Acme',
      brief: 'a brief',
      step: 'artifacts',
      awaitingApproval: true,
      status: 'active',
      created: now,
      updated: now,
    };
    await store.save(state);
  };

  const buildPublishHttp = (): HttpClient => ({
    async request<T>(opts: RequestOpts): Promise<T> {
      if (opts.path === 'auth/login') return { token: 'user' } as T;
      if (opts.path === 'auth/business/login') return { token: 'biz', businessRole: 'ADMIN' } as T;
      if (opts.method === 'PATCH' && opts.path === 'business/courses/c1/publish') {
        return { id: 'c1', status: 'PUBLISHED' } as T;
      }
      throw new Error(`fake http: unexpected request ${opts.method} ${opts.path}`);
    },
  });

  it('persists status: "published" on the memory once the publish gate is approved', async () => {
    const rtHolder = { current: await makeRuntime(buildPublishHttp(), root) };
    await seedAtArtifacts(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_approve')!({ sessionId: 's1' });

    const reloaded = await rtHolder.current.store.load('staging', 's1');
    expect(reloaded.status).toBe('published');
  });

  it('the persisted memory no longer trips reconcile\'s "never marked published" warning', async () => {
    const rtHolder = { current: await makeRuntime(buildPublishHttp(), root) };
    await seedAtArtifacts(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_approve')!({ sessionId: 's1' });

    const memory = await rtHolder.current.store.load('staging', 's1');
    const differences = reconcile(memory, { id: 'c1', status: 'PUBLISHED' }, []);
    expect(differences.find((d) => d.what === 'published')).toBeUndefined();
  });

  it('keeps status "published" through a subsequent pbl_abort, so reconcile does not falsely warn it was never published', async () => {
    const rtHolder = { current: await makeRuntime(buildPublishHttp(), root) };
    await seedAtArtifacts(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_approve')!({ sessionId: 's1' }); // publish gate
    await handlers.get('pbl_abort')!({ sessionId: 's1' });

    const reloaded = await rtHolder.current.store.load('staging', 's1');
    expect(reloaded.status).toBe('published');

    // The load-bearing assertion: a test checking only the field above would
    // pass even if pbl_abort's fix and reconcile's check disagreed on what
    // "published" means — feeding the reloaded memory back into reconcile
    // against a PUBLISHED course is what actually proves the false warning
    // from the bug report is gone.
    const differences = reconcile(reloaded, { id: 'c1', status: 'PUBLISHED' }, []);
    expect(differences.find((d) => d.what === 'published')).toBeUndefined();
  });
});

describe('pbl_approve — reopens a course closed with pbl_abort', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pbl-mcp-approve-reopen-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const seedClosed = async (store: CourseMemoryStore): Promise<void> => {
    const now = new Date().toISOString();
    const state: CourseMemory = {
      id: 's1',
      title: 'a course',
      env: 'staging',
      courseId: 'c1',
      businessName: 'Acme',
      brief: 'a brief',
      step: 'context',
      awaitingApproval: true,
      status: 'closed',
      created: now,
      updated: now,
    };
    await store.save(state);
  };

  it('flips status back to "active" when approving after resuming a closed course', async () => {
    const { http } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedClosed(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_approve')!({ sessionId: 's1' });

    const reloaded = await rtHolder.current.store.load('staging', 's1');
    expect(reloaded.status).toBe('active');
  });
});

describe('pbl_revise — course log entry', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pbl-mcp-revise-log-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const seedAtSkills = async (store: CourseMemoryStore): Promise<void> => {
    const now = new Date().toISOString();
    const state: CourseMemory = {
      id: 's1',
      title: 'a brief',
      env: 'staging',
      courseId: 'c1',
      businessName: 'Acme',
      brief: 'a brief',
      step: 'skills',
      awaitingApproval: true,
      status: 'active',
      created: now,
      updated: now,
    };
    await store.save(state);
  };

  it('writes exactly one log entry carrying the given reason', async () => {
    const { http } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedAtSkills(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_revise')!({
      sessionId: 's1',
      step: 'context',
      reason: 'Wrong duration selected',
    });

    const file = join(root, 'staging', 's1.md');
    const text = await readFile(file, 'utf8');
    const entryCount = (text.match(/^### \d{2}:\d{2} · /gm) ?? []).length;
    expect(entryCount).toBe(1);
    expect(text).toMatch(/### \d{2}:\d{2} · context — revised/);
    expect(text).toContain('Wrong duration selected');
  });

  it('records "No reason given." when no reason is supplied', async () => {
    const { http } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedAtSkills(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_revise')!({ sessionId: 's1', step: 'context' });

    const file = join(root, 'staging', 's1.md');
    const text = await readFile(file, 'utf8');
    expect(text).toContain('No reason given.');
  });

  it('unaffected by decision-line logging: neither selectSkills nor selectProblem given produces the same entry as before', async () => {
    const { http } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedAtSkills(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_revise')!({
      sessionId: 's1',
      step: 'context',
      reason: 'redoing context',
    });

    const file = join(root, 'staging', 's1.md');
    const text = await readFile(file, 'utf8');
    // No decision line should appear at all — the entry is exactly
    // reason + describeProduced's output, unchanged from before this fix.
    expect(text).not.toContain('Kept skills:');
    expect(text).not.toContain('Chose problem:');
    expect(text).toContain('### ');
    const detailMatch = /— revised\n([\s\S]*?)\n\n## Notes/.exec(text);
    expect(detailMatch?.[1]).toBe('redoing context\nGenerated 0 skills, 0 AI-recommended.');
  });

  it('includes "Kept skills: ..." after the reason when revising the skills selection', async () => {
    const http: HttpClient = {
      async request<T>(opts: RequestOpts): Promise<T> {
        if (opts.path === 'auth/login') return { token: 'user' } as T;
        if (opts.path === 'auth/business/login') return { token: 'biz', businessRole: 'ADMIN' } as T;
        if (opts.method === 'GET' && opts.path === 'business/courses/c1') {
          return {
            id: 'c1', status: 'INITIALIZING',
            CourseSkills: [
              { id: 'cs1', isSelected: true, CoreCompetencyModel: { id: 'm1', name: 'Systems Mapping' } },
              { id: 'cs2', isSelected: true, CoreCompetencyModel: { id: 'm2', name: 'Feedback Loops' } },
            ],
          } as T;
        }
        if (opts.method === 'PATCH' && /course-skills\//.test(opts.path)) {
          return { id: 'c1', status: 'INITIALIZING' } as T;
        }
        if (opts.method === 'POST' && opts.path === 'business/courses/c1/course-problems/generate') {
          return { id: 'c1', status: 'INITIALIZING', CourseProblems: [] } as T;
        }
        throw new Error(`fake http: unexpected request ${opts.method} ${opts.path}`);
      },
    };
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedAtSkills(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_revise')!({
      sessionId: 's1',
      step: 'problems',
      reason: 'wrong skills kept last time',
      selectSkills: ['Systems Mapping'],
    });

    const text = await readFile(join(root, 'staging', 's1.md'), 'utf8');
    expect(text).toContain('Kept skills: Systems Mapping');
    // Ordering: reason first, then the decision line — the reason must not be
    // dropped by the addition of the decision line.
    expect(text).toContain('wrong skills kept last time\nKept skills: Systems Mapping');
    expect(text).not.toContain('Feedback Loops');
  });

  it('includes \'Chose problem: "..."\' after the reason when revising the problem selection', async () => {
    const http: HttpClient = {
      async request<T>(opts: RequestOpts): Promise<T> {
        if (opts.path === 'auth/login') return { token: 'user' } as T;
        if (opts.path === 'auth/business/login') return { token: 'biz', businessRole: 'ADMIN' } as T;
        if (opts.method === 'GET' && opts.path === 'business/courses/c1') {
          return {
            id: 'c1', status: 'INITIALIZING',
            CourseProblems: [{ id: 'p1', title: 'Municipal water shortage', isSelected: false }],
          } as T;
        }
        if (opts.method === 'PATCH' && /course-problems\//.test(opts.path)) {
          return { id: 'c1', status: 'INITIALIZING' } as T;
        }
        if (opts.method === 'POST' && opts.path === 'business/courses/c1/content-units/generate') {
          return [] as T;
        }
        throw new Error(`fake http: unexpected request ${opts.method} ${opts.path}`);
      },
    };
    const rtHolder = { current: await makeRuntime(http, root) };
    await seedAtSkills(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_revise')!({
      sessionId: 's1',
      step: 'outline',
      reason: 'wrong problem chosen last time',
      selectProblem: 'Municipal water shortage',
    });

    const text = await readFile(join(root, 'staging', 's1.md'), 'utf8');
    expect(text).toContain('Chose problem: "Municipal water shortage"');
    expect(text).toContain('wrong problem chosen last time\nChose problem: "Municipal water shortage"');
    expect(text).not.toContain('p1');
  });
});

describe('pbl_abort — closes rather than deletes', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pbl-mcp-abort-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const seed = async (store: CourseMemoryStore): Promise<void> => {
    const now = new Date().toISOString();
    const state: CourseMemory = {
      id: 's1',
      title: 'a course',
      env: 'staging',
      courseId: 'c1',
      businessName: 'Acme',
      brief: 'a brief',
      step: 'skills',
      awaitingApproval: true,
      status: 'active',
      created: now,
      updated: now,
    };
    await store.save(state);
  };

  it('leaves the course file in place, marked closed, with one log entry, and still loadable by pbl_status', async () => {
    const { http } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    await seed(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_abort')!({ sessionId: 's1' });

    // The file must still exist and be loadable — a delete-based
    // implementation would make this load() reject with "No course ... ".
    const reloaded = await rtHolder.current.store.load('staging', 's1');
    expect(reloaded.status).toBe('closed');
    expect(reloaded.title).toBe('a course');

    const file = join(root, 'staging', 's1.md');
    const text = await readFile(file, 'utf8');
    const entryCount = (text.match(/^### \d{2}:\d{2} · /gm) ?? []).length;
    expect(entryCount).toBe(1);
    expect(text).toMatch(/### \d{2}:\d{2} · skills — closed/);
  });

  it('clears activeSessionId only when the aborted session was the active one', async () => {
    const { http } = buildFakeHttp('c1');
    const rtHolder = { current: await makeRuntime(http, root) };
    rtHolder.current.activeSessionId = 's1';
    await seed(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_abort')!({ sessionId: 's1' });

    expect(rtHolder.current.activeSessionId).toBeUndefined();
  });
});

describe('pbl_resume', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pbl-mcp-resume-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const buildResumeHttp = () => {
    const calls: RequestOpts[] = [];
    const http: HttpClient = {
      async request<T>(opts: RequestOpts): Promise<T> {
        calls.push(opts);
        if (opts.path === 'auth/login') return { id: 'u1', token: 'user' } as T;
        if (opts.path === 'auth/business/login') {
          return { token: 'biz', businessRole: 'ADMIN' } as T;
        }
        if (opts.method === 'GET' && opts.path === 'user/profile/u1') {
          return {
            usersInBusiness: [
              { businessId: 'b1', role: 'EDUCATOR', businessUserInBusiness: { id: 'b1', name: 'Acme' } },
            ],
          } as T;
        }
        if (opts.method === 'GET' && opts.path === 'business/courses/c1') {
          return { id: 'c1', title: 'Course Title', status: 'DRAFT', CourseContexts: [] } as T;
        }
        if (opts.method === 'GET' && opts.path === 'business/courses/c1/content-units') {
          return [{ id: 'cu1', title: 'Unit One' }] as T;
        }
        throw new Error(`fake http: unexpected request ${opts.method} ${opts.path}`);
      },
    };
    return { http, calls };
  };

  const seed = async (store: CourseMemoryStore): Promise<void> => {
    const now = new Date().toISOString();
    const state: CourseMemory = {
      id: 's1',
      title: 'a course',
      env: 'staging',
      courseId: 'c1',
      businessName: 'Acme',
      brief: 'a brief',
      step: 'skills',
      awaitingApproval: true,
      status: 'active',
      created: now,
      updated: now,
    };
    await store.save(state);
  };

  it('reopens by slug, re-resolves the business, and reports differences without mutating the file', async () => {
    const { http, calls } = buildResumeHttp();
    const rtHolder = { current: await makeRuntime(http, root) };
    await seed(rtHolder.current.store);
    const before = await readFile(join(root, 'staging', 's1.md'), 'utf8');
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    const result = await handlers.get('pbl_resume')!({ course: 's1' });

    expect(result.content[0].text).toContain('Resumed "a course"');
    // Memory stopped at "skills" but the backend is already DRAFT — reconcile
    // should surface that as a difference.
    expect(result.content[0].text).toContain('frozen');
    expect(rtHolder.current.activeSessionId).toBe('s1');

    // The business really is re-resolved by name — not just trusted from the
    // memory file. A stub that mapped resolveBusiness's input straight back
    // to itself as an id would leave every other assertion here green, so
    // this checks resolveBusiness's own listBusinesses call actually fired.
    const paths = calls.map((c) => `${c.method} ${c.path}`);
    expect(paths).toContain('GET user/profile/u1');

    // pbl_resume must never advance or otherwise write to the file.
    const after = await readFile(join(root, 'staging', 's1.md'), 'utf8');
    expect(after).toBe(before);
  });

  it('never prints the courseId or a bare UUID anywhere in its output', async () => {
    const { http } = buildResumeHttp();
    const rtHolder = { current: await makeRuntime(http, root) };
    await seed(rtHolder.current.store);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    const result = await handlers.get('pbl_resume')!({ course: 's1' });

    expect(result.content[0].text).not.toContain('c1');
  });
});

/**
 * Regression: a bricked memory file (see memory.test.ts) made pbl_abort throw
 * on the load that precedes everything else — so the one tool that should have
 * cleaned up the mess was the one tool that could not run. Removal stays the
 * user's job (`rm`, by design — the store has no delete), but abort must say
 * exactly what to remove instead of surfacing a raw parse error.
 */
describe('pbl_abort — unreadable memory file', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pbl-mcp-abort-broken-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const brick = async (id: string) => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(root, 'staging'), { recursive: true });
    // Exactly what the undefined-courseId bug produced on disk.
    await writeFile(
      join(root, 'staging', `${id}.md`),
      '---\ncourse: "Test brief"\nenv: "staging"\ncourseId: undefined\n---\n\n# Test brief\n\n## Notes\nkeep me\n',
      'utf8',
    );
  };

  const stubHttp = (): HttpClient =>
    ({ request: vi.fn().mockResolvedValue({ token: 'biz', businessRole: 'ADMIN' }) }) as unknown as HttpClient;

  it('names the file and how to remove it, instead of throwing a parse error', async () => {
    await brick('bricked');
    const rtHolder = { current: await makeRuntime(stubHttp(), root) };
    rtHolder.current.activeSessionId = 'bricked';
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    const result = await handlers.get('pbl_abort')!({ sessionId: 'bricked' });
    const out = result.content[0].text;

    expect(out).toContain(join(root, 'staging', 'bricked.md'));
    expect(out).toMatch(/rm /);
    // The underlying reason stays visible — the operator should know why.
    expect(out).toMatch(/courseId/);
  });

  it('clears the active session pointer even though the file could not be read', async () => {
    await brick('bricked');
    const rtHolder = { current: await makeRuntime(stubHttp(), root) };
    rtHolder.current.activeSessionId = 'bricked';
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_abort')!({ sessionId: 'bricked' });

    // Without this, switchEnvironment stays blocked by a session that can
    // never be closed — the user is wedged until they edit files by hand.
    expect(rtHolder.current.activeSessionId).toBeUndefined();
  });

  it('leaves the unreadable file untouched rather than rewriting it', async () => {
    await brick('bricked');
    const file = join(root, 'staging', 'bricked.md');
    const before = await readFile(file, 'utf8');
    const rtHolder = { current: await makeRuntime(stubHttp(), root) };
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    await handlers.get('pbl_abort')!({ sessionId: 'bricked' });

    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('still closes a readable session normally', async () => {
    const rtHolder = { current: await makeRuntime(stubHttp(), root) };
    await rtHolder.current.store.save({
      id: 'fine', title: 'Fine', env: 'staging', courseId: 'c1',
      businessName: 'Acme', brief: 'b', step: 'context', awaitingApproval: true,
      status: 'active', created: '2026-08-05T10:00:00.000Z',
      updated: '2026-08-05T10:00:00.000Z',
    } as CourseMemory);
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    const result = await handlers.get('pbl_abort')!({ sessionId: 'fine' });

    expect(result.content[0].text).toContain('Closed "Fine"');
    expect((await rtHolder.current.store.load('staging', 'fine')).status).toBe('closed');
  });
});

describe('pbl_approve — detail and artifacts gates', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pbl-mcp-detail-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Records every request and answers the reads each gate makes. */
  const gateHttp = (answers: [RegExp, unknown][]) => {
    const calls: RequestOpts[] = [];
    const request = vi.fn(async (opts: RequestOpts) => {
      calls.push(opts);
      if (opts.path.startsWith('auth/')) return { token: 'biz', businessRole: 'ADMIN' };
      for (const [re, body] of answers) if (re.test(opts.path)) return body;
      return {};
    });
    return { http: { request } as unknown as HttpClient, calls };
  };

  const seed = async (store: CourseMemoryStore, step: 'outline' | 'detail') =>
    store.save({
      id: 's1', title: 'A course', env: 'staging', courseId: 'c1',
      businessName: 'Acme', brief: 'b', step, awaitingApproval: true,
      status: 'active', created: '2026-08-06T10:00:00.000Z',
      updated: '2026-08-06T10:00:00.000Z',
    } as CourseMemory);

  it('creates the breakdown and logs it by name, with no id in the output', async () => {
    const { http } = gateHttp([
      [/^business\/courses\/c1$/, {
        id: 'c1', status: 'DRAFT',
        CourseSkills: [{
          id: 'cs1', isSelected: true,
          CoreCompetencyModel: { id: 'ccm1', name: 'Visual Hierarchy' },
        }],
      }],
      // Anchored on the preceding slash: "sub-content-units" ends in
      // "content-units" too, so an unanchored /content-units$/ would also
      // match the create-sub-unit route below and shadow it (checked first,
      // in array order) — returning an array with no top-level `id` for
      // what should be the created sub-unit.
      [/\/content-units$/, [{ id: 'cu1', title: 'Module One' }]],
      [/sub-content-units$/, { id: 'su1', title: 'Lesson A' }],
      // The skill's competency has exactly one level, so the breakdown below
      // can omit `level` and have it used automatically.
      [/^business\/competencies\/ccm1$/, { id: 'ccm1', Levels: [{ id: 'lvl1', name: 'Foundational' }] }],
    ]);
    const rtHolder = { current: await makeRuntime(http, root) };
    await seed(rtHolder.current.store, 'outline');
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    const result = await handlers.get('pbl_approve')!({
      sessionId: 's1',
      subUnits: [{
        contentUnit: 'Module One', title: 'Lesson A', minutes: 45,
        skills: [{ name: 'Visual Hierarchy' }],
      }],
    });

    const out = result.content[0].text;
    expect(out).toContain('Module One › Lesson A');
    expect(out).toContain('Visual Hierarchy');
    expect(out).not.toMatch(/cu1|su1|ccm1|lvl1/);

    const file = await readFile(join(root, 'staging', 's1.md'), 'utf8');
    expect(file).toContain('Lesson A');
    expect(file).not.toMatch(/cu1|su1|ccm1|lvl1/);
    expect((await rtHolder.current.store.load('staging', 's1')).step).toBe('detail');
  });

  it('reports an artifact failure and still advances the gate', async () => {
    let generateCalls = 0;
    const calls: RequestOpts[] = [];
    const request = vi.fn(async (opts: RequestOpts) => {
      calls.push(opts);
      if (opts.path.startsWith('auth/')) return { token: 'biz', businessRole: 'ADMIN' };
      if (opts.path.endsWith('/artifact/generate')) {
        generateCalls += 1;
        if (generateCalls === 1) throw new Error('upstream exploded');
        return {};
      }
      if (/content-units\/cu1\/sub-content-units$/.test(opts.path)) {
        return [{ id: 'su1', title: 'Lesson A' }, { id: 'su2', title: 'Lesson B' }];
      }
      if (opts.path.endsWith('/content-units')) return [{ id: 'cu1', title: 'Module One' }];
      return {};
    });
    const rtHolder = {
      current: await makeRuntime({ request } as unknown as HttpClient, root),
    };
    await seed(rtHolder.current.store, 'detail');
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    const result = await handlers.get('pbl_approve')!({ sessionId: 's1' });
    const out = result.content[0].text;

    // Both were attempted: aborting on the first failure would have discarded
    // the second generation with no way to resume mid-gate.
    expect(generateCalls).toBe(2);
    expect(out).toContain('1 generated');
    expect(out).toContain('Lesson A — upstream exploded');
    expect((await rtHolder.current.store.load('staging', 's1')).step).toBe('artifacts');
  });
});

describe('pbl_status — breakdown listing', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pbl-mcp-status-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const seedAt = async (store: CourseMemoryStore, step: CourseMemory['step']) =>
    store.save({
      id: 's1', title: 'A course', env: 'staging', courseId: 'c1',
      businessName: 'Acme', brief: 'b', step, awaitingApproval: true,
      status: 'active', created: '2026-08-06T10:00:00.000Z',
      updated: '2026-08-06T10:00:00.000Z',
    } as CourseMemory);

  it('does not call content-units/sub-units/competencies for a course that has not reached "detail"', async () => {
    const calls: RequestOpts[] = [];
    const request = vi.fn(async (opts: RequestOpts) => {
      calls.push(opts);
      if (opts.path.startsWith('auth/')) return { token: 'biz', businessRole: 'ADMIN' };
      // Any content-units, sub-content-units, course or competency call is
      // exactly what a pre-"skills" session must not pay for — fail loudly.
      throw new Error(`unexpected request ${opts.method} ${opts.path}`);
    });
    const rtHolder = {
      current: await makeRuntime({ request } as unknown as HttpClient, root),
    };
    await seedAt(rtHolder.current.store, 'context');
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    const result = await handlers.get('pbl_status')!({ sessionId: 's1' });

    expect(result.content[0].text).not.toContain('Breakdown:');
    expect(result.content[0].text).not.toContain('Skills:');
    // The stronger assertion: no non-auth call happened at all, not merely
    // that content-units wasn't one of them — this is what actually proves
    // zero level lookups, rather than just an absent section in the text.
    expect(calls.every((c) => c.path.startsWith('auth/'))).toBe(true);
  });

  it('lists content units, sub-units and their skills by name, with no id, once "detail" is reached', async () => {
    const request = vi.fn(async (opts: RequestOpts) => {
      if (opts.path.startsWith('auth/')) return { token: 'biz', businessRole: 'ADMIN' };
      if (opts.path === 'business/courses/c1') {
        return {
          id: 'c1', status: 'DRAFT',
          CourseSkills: [
            { id: 'cs1', isSelected: true, CoreCompetencyModel: { id: 'ccm1', name: 'Visual Hierarchy' } },
          ],
        };
      }
      if (opts.path === 'business/competencies/ccm1') {
        return { id: 'ccm1', Levels: [{ id: 'lvl1', name: 'Foundational' }] };
      }
      if (/sub-content-units\/su1\/skills$/.test(opts.path)) {
        return [{ coreCompetencyModelId: 'ccm1', levelId: 'lvl1', name: 'Visual Hierarchy' }];
      }
      if (/content-units\/cu1\/sub-content-units$/.test(opts.path)) {
        return [{ id: 'su1', title: 'Lesson A' }];
      }
      if (opts.path.endsWith('/content-units')) return [{ id: 'cu1', title: 'Module One' }];
      throw new Error(`unexpected request ${opts.method} ${opts.path}`);
    });
    const rtHolder = {
      current: await makeRuntime({ request } as unknown as HttpClient, root),
    };
    await seedAt(rtHolder.current.store, 'detail');
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    const result = await handlers.get('pbl_status')!({ sessionId: 's1' });
    const out = result.content[0].text;

    expect(out).toContain('Skills:');
    expect(out).toContain('Visual Hierarchy — Foundational');
    expect(out).toContain('Breakdown:');
    expect(out).toContain('Module One');
    expect(out).toContain('Lesson A');
    expect(out).toContain('Visual Hierarchy');
    expect(out).not.toMatch(/cu1|su1|ccm1|lvl1/);
  });

  // Regression guard for the UUID non-negotiable: SubUnitSkill.name is
  // optional, so a skill with only a bare coreCompetencyModelId must never
  // render as that id. The fixture below makes the forbidden id genuinely
  // reachable (the skill has no name), so this test cannot pass vacuously.
  it('never renders a bare coreCompetencyModelId in the breakdown — falls back to a count', async () => {
    const request = vi.fn(async (opts: RequestOpts) => {
      if (opts.path.startsWith('auth/')) return { token: 'biz', businessRole: 'ADMIN' };
      if (opts.path === 'business/courses/c1') {
        return { id: 'c1', status: 'DRAFT', CourseSkills: [] };
      }
      if (/sub-content-units\/su1\/skills$/.test(opts.path)) {
        return [{ coreCompetencyModelId: 'ccm-secret-uuid' }];
      }
      if (/content-units\/cu1\/sub-content-units$/.test(opts.path)) {
        return [{ id: 'su1', title: 'Lesson A' }];
      }
      if (opts.path.endsWith('/content-units')) return [{ id: 'cu1', title: 'Module One' }];
      throw new Error(`unexpected request ${opts.method} ${opts.path}`);
    });
    const rtHolder = {
      current: await makeRuntime({ request } as unknown as HttpClient, root),
    };
    await seedAt(rtHolder.current.store, 'detail');
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    const result = await handlers.get('pbl_status')!({ sessionId: 's1' });
    const out = result.content[0].text;

    expect(out).toContain('Lesson A (1 skill)');
    expect(out).not.toContain('ccm-secret-uuid');
  });
});

describe('pbl_status — skills listing', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pbl-mcp-status-skills-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const seedAt = async (store: CourseMemoryStore, step: CourseMemory['step']) =>
    store.save({
      id: 's1', title: 'A course', env: 'staging', courseId: 'c1',
      businessName: 'Acme', brief: 'b', step, awaitingApproval: true,
      status: 'active', created: '2026-08-06T10:00:00.000Z',
      updated: '2026-08-06T10:00:00.000Z',
    } as CourseMemory);

  it('shows selected skills and their levels, one competency call per distinct selected skill, no id anywhere', async () => {
    // Realistic UUIDs, not "ccm1"/"lvl1" — a fixture that used short fake ids
    // could pass a broken "hide only these exact strings" implementation and
    // still leak a real one.
    const VH_ID = '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';
    const CR_ID = '9c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
    const request = vi.fn(async (opts: RequestOpts) => {
      if (opts.path.startsWith('auth/')) return { token: 'biz', businessRole: 'ADMIN' };
      if (opts.path === 'business/courses/c1') {
        return {
          id: 'c1', status: 'DRAFT',
          CourseSkills: [
            {
              id: '3f9c1e2a-4b7d-4e21-9a4a-1c2d3e4f5061', isSelected: true,
              CoreCompetencyModel: { id: VH_ID, name: 'Visual Hierarchy' },
            },
            {
              id: '8b2c3d4e-5f6a-4b7c-9d0e-1f2a3b4c5d6e', isSelected: true,
              CoreCompetencyModel: { id: CR_ID, name: 'Critique' },
            },
            {
              id: 'e0f1a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b', isSelected: false,
              CoreCompetencyModel: { id: 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a', name: 'Ignored (unselected)' },
            },
          ],
        };
      }
      if (opts.path === `business/competencies/${VH_ID}`) {
        return { id: VH_ID, Levels: [
          { id: 'l1', name: 'Foundational' }, { id: 'l2', name: 'Proficient' }, { id: 'l3', name: 'Advanced' },
        ] };
      }
      if (opts.path === `business/competencies/${CR_ID}`) {
        return { id: CR_ID, Levels: [] };
      }
      throw new Error(`unexpected request ${opts.method} ${opts.path}`);
    });
    const rtHolder = {
      current: await makeRuntime({ request } as unknown as HttpClient, root),
    };
    await seedAt(rtHolder.current.store, 'skills');
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    const result = await handlers.get('pbl_status')!({ sessionId: 's1' });
    const out = result.content[0].text;

    expect(out).toContain('Skills:');
    expect(out).toContain('Visual Hierarchy — Foundational, Proficient, Advanced');
    expect(out).toContain('Critique — (no levels)');
    expect(out).not.toContain('Ignored (unselected)');
    // Only the two selected skills are fetched — never the unselected one.
    const competencyCalls = request.mock.calls.filter((c) =>
      (c[0] as RequestOpts).path.startsWith('business/competencies/'));
    expect(competencyCalls).toHaveLength(2);
    expect(out).not.toMatch(
      /3f9c1e2a|8b2c3d4e|e0f1a2b3|7a1b2c3d|9c3d4e5f|d1e2f3a4|l1|l2|l3/,
    );
  });

  it('makes no getCourse or level calls for a session still at "context"', async () => {
    const request = vi.fn(async (opts: RequestOpts) => {
      if (opts.path.startsWith('auth/')) return { token: 'biz', businessRole: 'ADMIN' };
      throw new Error(`unexpected request ${opts.method} ${opts.path}`);
    });
    const rtHolder = {
      current: await makeRuntime({ request } as unknown as HttpClient, root),
    };
    await seedAt(rtHolder.current.store, 'context');
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    const result = await handlers.get('pbl_status')!({ sessionId: 's1' });

    expect(result.content[0].text).not.toContain('Skills:');
    expect(request.mock.calls.every((c) => (c[0] as RequestOpts).path.startsWith('auth/'))).toBe(true);
  });

  it('renders "(levels unavailable)" for one failing lookup, without failing pbl_status or the other skill', async () => {
    const request = vi.fn(async (opts: RequestOpts) => {
      if (opts.path.startsWith('auth/')) return { token: 'biz', businessRole: 'ADMIN' };
      if (opts.path === 'business/courses/c1') {
        return {
          id: 'c1', status: 'DRAFT',
          CourseSkills: [
            { id: 'cs1', isSelected: true, CoreCompetencyModel: { id: 'ccm-ok', name: 'Visual Hierarchy' } },
            { id: 'cs2', isSelected: true, CoreCompetencyModel: { id: 'ccm-bad', name: 'Typographic Systems' } },
          ],
        };
      }
      if (opts.path === 'business/competencies/ccm-ok') {
        return { id: 'ccm-ok', Levels: [{ id: 'l1', name: 'Foundational' }] };
      }
      if (opts.path === 'business/competencies/ccm-bad') {
        throw new Error('upstream exploded');
      }
      throw new Error(`unexpected request ${opts.method} ${opts.path}`);
    });
    const rtHolder = {
      current: await makeRuntime({ request } as unknown as HttpClient, root),
    };
    await seedAt(rtHolder.current.store, 'skills');
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    // The call itself must still resolve (not throw) despite one failing lookup.
    const result = await handlers.get('pbl_status')!({ sessionId: 's1' });
    const out = result.content[0].text;

    expect(out).toContain('Visual Hierarchy — Foundational');
    expect(out).toContain('Typographic Systems — (levels unavailable)');
  });
});

/**
 * `direct.ts`'s tools take a courseId directly, so these need no seeded memory —
 * just a runtime whose http answers the reads each tool makes. `routed` maps a
 * path fragment to a response and records every request.
 */
const routed = (answers: [RegExp, unknown][]) => {
  const calls: RequestOpts[] = [];
  const request = vi.fn(async (opts: RequestOpts) => {
    calls.push(opts);
    if (opts.path === 'auth/business/login' || opts.path === 'auth/login') {
      return { token: 'biz', businessRole: 'ADMIN' };
    }
    for (const [re, body] of answers) if (re.test(opts.path)) return body;
    return {};
  });
  return { http: { request } as unknown as HttpClient, calls };
};

const directRuntime = async (http: HttpClient): Promise<{ current: Runtime }> => {
  const auth = new AuthManager(http, { email: 'a@b.c', password: 'pw' });
  await auth.loginBusiness('b1', 'Acme');
  return {
    current: {
      cfg: CFG, env: 'staging', appUrl: 'https://stage.app', http, auth,
      store: new CourseMemoryStore('/tmp/unused-by-direct-tools'),
    } as unknown as Runtime,
  };
};

describe('pbl_add_resource — addressed by name', () => {
  const answers: [RegExp, unknown][] = [
    [/content-units\/cu1\/sub-content-units$/, [{ id: 'su1', title: 'Lesson A' }]],
    [/content-units$/, [{ id: 'cu1', title: 'Module One' }]],
  ];

  it('resolves content unit and sub-unit names to ids', async () => {
    const { http, calls } = routed(answers);
    const handlers = captureHandlers(registerDirectTools, await directRuntime(http));

    await handlers.get('pbl_add_resource')!({
      courseId: 'c1', contentUnit: 'Module One', subUnit: 'Lesson A',
      title: 'Doc', type: 'LINK', url: 'https://x.test',
    });

    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/resources'));
    expect(post!.path).toBe(
      'business/courses/c1/content-units/cu1/sub-content-units/su1/resources',
    );
  });

  it('names the available sub-units when one does not match, without leaking an id', async () => {
    const { http } = routed(answers);
    const handlers = captureHandlers(registerDirectTools, await directRuntime(http));

    const err = await handlers.get('pbl_add_resource')!({
      courseId: 'c1', contentUnit: 'Module One', subUnit: 'Nope',
      title: 'Doc', type: 'LINK', url: 'https://x.test',
    }).then(() => undefined, (e: Error) => e);

    expect(err!.message).toContain('Lesson A');
    expect(err!.message).not.toContain('su1');
  });
});

// Regression: pbl_publish and pbl_invite take a raw courseId and operate on
// any course, session or not — they are escape hatches, not gate N of the
// STEP_ORDER pipeline. Their live tools/list description strings used to say
// "Gate 5"/"Gate 6" (stale even against the README, which had already moved
// to 7/8 elsewhere) — pin that the number is gone rather than renumbered.
describe('direct tool descriptions', () => {
  it('carry no stale "Gate N" numbering', async () => {
    const { http } = routed([]);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const descriptions = new Map<string, string>();
    (server as unknown as { tool: (...a: unknown[]) => unknown }).tool = (
      ...args: unknown[]
    ) => {
      descriptions.set(args[0] as string, args[1] as string);
      return undefined;
    };
    registerDirectTools(server, await directRuntime(http));

    expect(descriptions.get('pbl_publish')).not.toMatch(/Gate \d/);
    expect(descriptions.get('pbl_invite')).not.toMatch(/Gate \d/);
  });
});

describe('pbl_publish — precondition', () => {
  const publishCalled = (calls: RequestOpts[]) =>
    calls.some((c) => c.path.endsWith('/publish'));

  it('refuses when a content unit has no sub-units, naming it', async () => {
    const { http, calls } = routed([
      [/content-units\/cu1\/sub-content-units$/, [{ id: 'su1', title: 'Lesson A' }]],
      [/content-units\/cu1\/sub-content-units\/su1\/skills$/, [{ coreCompetencyModelId: 'ccm1' }]],
      [/content-units\/cu2\/sub-content-units$/, []],
      [/content-units$/, [{ id: 'cu1', title: 'Module One' }, { id: 'cu2', title: 'Module Two' }]],
    ]);
    const handlers = captureHandlers(registerDirectTools, await directRuntime(http));

    const err = await handlers.get('pbl_publish')!({ courseId: 'c1' })
      .then(() => undefined, (e: Error) => e);

    expect(err!.message).toContain('Module Two');
    expect(err!.message).not.toContain('cu2');
    expect(publishCalled(calls)).toBe(false);
  });

  it('refuses when a sub-unit has no skills, naming its content unit', async () => {
    const { http, calls } = routed([
      [/sub-content-units\/su1\/skills$/, []],
      [/content-units\/cu1\/sub-content-units$/, [{ id: 'su1', title: 'Lesson A' }]],
      [/content-units$/, [{ id: 'cu1', title: 'Module One' }]],
    ]);
    const handlers = captureHandlers(registerDirectTools, await directRuntime(http));

    const err = await handlers.get('pbl_publish')!({ courseId: 'c1' })
      .then(() => undefined, (e: Error) => e);

    expect(err!.message).toMatch(/Module One.*no sub-content unit with a skill/s);
    expect(publishCalled(calls)).toBe(false);
  });

  it('publishes when every content unit has a sub-unit with a skill', async () => {
    const { http, calls } = routed([
      [/sub-content-units\/su1\/skills$/, [{ coreCompetencyModelId: 'ccm1' }]],
      [/content-units\/cu1\/sub-content-units$/, [{ id: 'su1', title: 'Lesson A' }]],
      [/content-units$/, [{ id: 'cu1', title: 'Module One' }]],
    ]);
    const handlers = captureHandlers(registerDirectTools, await directRuntime(http));

    await handlers.get('pbl_publish')!({ courseId: 'c1' });

    expect(publishCalled(calls)).toBe(true);
  });
});
