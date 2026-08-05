import { describe, it, expect } from 'vitest';
import { reconcile, renderResume } from '../src/session/reconcile.js';
import type { CourseMemory } from '../src/session/memory.js';
import type { Course, ContentUnit } from '../src/api/builder.js';

const memory = (over: Partial<CourseMemory> = {}): CourseMemory => ({
  id: 'intro', title: 'Intro', env: 'staging', courseId: 'c1',
  businessName: 'Acme', brief: 'b', step: 'skills', awaitingApproval: true,
  status: 'active', created: '2026-08-05T10:00:00.000Z',
  updated: '2026-08-05T10:00:00.000Z', ...over,
});
const course = (over: Partial<Course> = {}): Course =>
  ({ id: 'c1', title: 'Intro', status: 'INITIALIZING', ...over });
const units = (n: number): ContentUnit[] =>
  Array.from({ length: n }, (_, i) => ({ id: `u${i}`, title: `Unit ${i}` }));

describe('reconcile', () => {
  it('reports nothing when memory and backend agree', () => {
    expect(reconcile(memory(), course(), [])).toEqual([]);
  });

  it('reports a title change made in the web app', () => {
    const d = reconcile(memory(), course({ title: 'Renamed' }), []);
    expect(d).toHaveLength(1);
    expect(d[0]!.detail).toMatch(/Renamed/);
  });

  it('reports that the outline already exists when memory predates the freeze', () => {
    const d = reconcile(memory({ step: 'skills' }), course({ status: 'DRAFT' }), units(6));
    expect(d.map((x) => x.what)).toContain('course status');
    expect(d.find((x) => x.what === 'course status')!.detail).toMatch(/frozen/);
  });

  it('does not report the freeze once memory has reached outline', () => {
    const d = reconcile(memory({ step: 'outline' }), course({ status: 'DRAFT' }), units(6));
    expect(d.map((x) => x.what)).not.toContain('course status');
  });

  it('reports a backend publish the memory does not know about', () => {
    const d = reconcile(memory({ status: 'active' }), course({ status: 'PUBLISHED' }), units(2));
    expect(d.map((x) => x.what)).toContain('published');
  });

  it('reports that the course was archived in the web app', () => {
    const d = reconcile(memory(), course({ status: 'ARCHIVED' }), []);
    expect(d.map((x) => x.what)).toContain('archived');
    expect(d.find((x) => x.what === 'archived')!.detail).toMatch(/archived/i);
  });

  // One fixture per branch that can push a Difference, each carrying the same
  // UUID in both courseId and course.id. A branch whose guard never evaluates
  // true here would let a future id-leaking regression in that branch through
  // unnoticed, so `diffs.length` is asserted first to prove the branch fired
  // before checking what it produced.
  const UUID = '8f14e45f-ceea-467a-9f0e-0d0a0d0a0d0a';
  const idLeakCases: Array<[string, () => ReturnType<typeof reconcile>]> = [
    [
      'title',
      () =>
        reconcile(
          memory({ courseId: UUID }),
          course({ id: UUID, title: 'Renamed' }),
          [],
        ),
    ],
    [
      'course status',
      () =>
        reconcile(
          memory({ courseId: UUID, step: 'skills' }),
          course({ id: UUID, status: 'DRAFT' }),
          units(3),
        ),
    ],
    [
      'published',
      () =>
        reconcile(
          memory({ courseId: UUID, status: 'active' }),
          course({ id: UUID, status: 'PUBLISHED' }),
          units(3),
        ),
    ],
    [
      'archived',
      () =>
        reconcile(
          memory({ courseId: UUID }),
          course({ id: UUID, status: 'ARCHIVED' }),
          [],
        ),
    ],
  ];

  it.each(idLeakCases)('never puts the courseId in a difference (%s branch)', (_label, run) => {
    const diffs = run();
    expect(diffs.length).toBeGreaterThan(0);
    for (const d of diffs) {
      expect(`${d.what} ${d.detail}`).not.toContain('8f14e45f');
    }
  });
});

describe('renderResume', () => {
  it('states both sides and lists differences', () => {
    const out = renderResume(
      memory(), course({ status: 'DRAFT', title: 'Renamed' }), units(6),
      reconcile(memory(), course({ status: 'DRAFT', title: 'Renamed' }), units(6)),
    );
    expect(out).toContain('staging · Acme');
    expect(out).toContain('Memory says: skills, awaiting approval');
    expect(out).toContain('Backend says: DRAFT, 6 content units');
    expect(out).toMatch(/⚠/);
  });

  it('says so plainly when there is nothing to report', () => {
    const out = renderResume(memory(), course(), [], []);
    expect(out).toContain('In sync with the backend.');
    expect(out).not.toMatch(/⚠/);
  });
});
