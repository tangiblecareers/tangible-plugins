import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createRuntime, switchEnvironment, type Runtime } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { AuthManager } from '../src/auth.js';
import { CourseMemoryStore, type CourseMemory } from '../src/session/memory.js';
import { registerSessionTools } from '../src/tools/session.js';
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
    const { http } = buildResumeHttp();
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
