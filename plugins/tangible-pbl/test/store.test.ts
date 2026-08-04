import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore, type SessionState } from '../src/session/store.js';

let root: string;
let store: SessionStore;

const state = (over: Partial<SessionState> = {}): SessionState => ({
  id: 's1',
  env: 'staging',
  courseId: 'c1',
  businessId: 'b1',
  businessName: 'Acme',
  brief: 'a brief',
  step: 'context',
  awaitingApproval: true,
  history: [],
  ...over,
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pbl-mcp-'));
  store = new SessionStore(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('SessionStore', () => {
  it('round-trips a session', async () => {
    await store.save(state());
    await expect(store.load('staging', 's1')).resolves.toEqual(state());
  });

  it('namespaces by environment — a staging id is invisible to production', async () => {
    await store.save(state());
    await expect(store.load('production', 's1')).rejects.toThrow(
      /No session "s1" in production/,
    );
  });

  it('keeps same-id sessions in different environments apart', async () => {
    await store.save(state());
    await store.save(state({ env: 'production', courseId: 'c2' }));
    expect((await store.load('staging', 's1')).courseId).toBe('c1');
    expect((await store.load('production', 's1')).courseId).toBe('c2');
  });

  it('lists only the requested environment', async () => {
    await store.save(state());
    await store.save(state({ id: 's2' }));
    await store.save(state({ id: 's3', env: 'production' }));
    const ids = (await store.list('staging')).map((s) => s.id).sort();
    expect(ids).toEqual(['s1', 's2']);
  });

  it('returns an empty list when the environment has no sessions', async () => {
    await expect(store.list('production')).resolves.toEqual([]);
  });

  it('deletes a session', async () => {
    await store.save(state());
    await store.delete('staging', 's1');
    await expect(store.load('staging', 's1')).rejects.toThrow(/No session/);
  });

  it('delete is idempotent', async () => {
    await expect(store.delete('staging', 'ghost')).resolves.toBeUndefined();
  });

  it('rejects path traversal attempts with absolute paths', async () => {
    await expect(store.load('staging', '../../etc/passwd')).rejects.toThrow(
      /Invalid session id/,
    );
  });

  it('rejects path traversal to sibling environments', async () => {
    await expect(store.load('staging', '../production/s1')).rejects.toThrow(
      /Invalid session id/,
    );
  });

  it('rejects save with unsafe id and creates no files outside root', async () => {
    const unsafeState = state({ id: '../outside/payload' });
    await expect(store.save(unsafeState)).rejects.toThrow(/Invalid session id/);
    // Verify no files were created outside the temp root
    const envDirs = await import('node:fs/promises').then((fs) =>
      fs.readdir(root).catch(() => []),
    );
    expect(envDirs).not.toContain('outside');
  });

  it('round-trips a session with a safe alphanumeric id', async () => {
    const safeId = 'abc123-xyz_456';
    await store.save(state({ id: safeId }));
    const loaded = await store.load('staging', safeId);
    expect(loaded.id).toBe(safeId);
  });
});
