import { describe, it, expect, vi } from 'vitest';
import { advance, assertRevisable, nextStep, STEP_ORDER } from '../src/session/machine.js';
import type { CourseMemory } from '../src/session/memory.js';

const state = (over: Partial<CourseMemory> = {}): CourseMemory => ({
  id: 's1', title: 'Intro', env: 'staging', courseId: 'c1',
  businessName: 'Acme', brief: 'brief', step: 'context',
  awaitingApproval: true, status: 'active',
  created: '2026-08-05T10:00:00.000Z', updated: '2026-08-05T10:00:00.000Z', ...over,
});

const SKILLS = [
  { id: 'cs1', isSelected: true, CoreCompetencyModel: { id: 'm1', name: 'Triage' } },
  { id: 'cs2', isSelected: true, CoreCompetencyModel: { id: 'm2', name: 'Comms' } },
];
const PROBLEMS = [
  { id: 'p1', title: 'Outage', isSelected: false },
  { id: 'p2', title: 'Breach', isSelected: false },
];

const deps = (over: Partial<Parameters<typeof advance>[0]> = {}) => ({
  generateSkills: vi.fn().mockResolvedValue({ id: 'c1', status: 'INITIALIZING', CourseSkills: SKILLS }),
  generateProblems: vi.fn().mockResolvedValue({ id: 'c1', status: 'INITIALIZING', CourseProblems: PROBLEMS }),
  generateContentUnits: vi.fn().mockResolvedValue([{ id: 'u1', title: 'Unit 1' }]),
  getCourse: vi.fn().mockResolvedValue({
    id: 'c1', status: 'DRAFT', CourseSkills: SKILLS, CourseProblems: PROBLEMS,
  }),
  selectSkill: vi.fn().mockResolvedValue({ id: 'c1', status: 'INITIALIZING' }),
  selectProblem: vi.fn().mockResolvedValue({ id: 'c1', status: 'INITIALIZING' }),
  publish: vi.fn().mockResolvedValue({ id: 'c1', status: 'PUBLISHED' }),
  invite: vi.fn().mockResolvedValue({}),
  ...over,
});

describe('STEP_ORDER', () => {
  it('matches the builder pipeline', () => {
    expect(STEP_ORDER).toEqual([
      'context', 'skills', 'problems', 'outline', 'detail', 'publish', 'invite', 'done',
    ]);
  });

  it('nextStep walks forward and stops at done', () => {
    expect(nextStep('context')).toBe('skills');
    expect(nextStep('invite')).toBe('done');
    expect(nextStep('done')).toBe('done');
  });
});

describe('the gate guarantee', () => {
  it('advances exactly one step per call', async () => {
    const d = deps();
    const { state: s } = await advance(d, state({ step: 'context' }));
    expect(s.step).toBe('skills');
    expect(d.generateSkills).toHaveBeenCalledTimes(1);
    expect(d.generateProblems).not.toHaveBeenCalled();
    expect(d.generateContentUnits).not.toHaveBeenCalled();
  });

  it('leaves the session awaiting approval after every advance', async () => {
    const { state: s } = await advance(deps(), state({ step: 'skills' }));
    expect(s.awaitingApproval).toBe(true);
  });

  it('never reaches publish without four explicit advances', async () => {
    const d = deps();
    let s = state({ step: 'context' });
    for (const expected of ['skills', 'problems', 'outline', 'detail']) {
      ({ state: s } = await advance(d, s, { selectProblem: 'p1' }));
      expect(s.step).toBe(expected);
      expect(d.publish).not.toHaveBeenCalled();
    }
  });

  it('refuses to advance a session that is not awaiting approval', async () => {
    await expect(
      advance(deps(), state({ step: 'skills', awaitingApproval: false })),
    ).rejects.toThrow(/already in flight/);
  });
});

describe('advance produces reviewable output', () => {
  it('returns generated skills at the skills gate', async () => {
    const { produced } = await advance(deps(), state({ step: 'context' }));
    expect(produced).toEqual({ kind: 'skills', skills: SKILLS });
  });

  it('applies a skill selection before generating problems', async () => {
    const d = deps();
    await advance(d, state({ step: 'skills' }), { selectSkills: ['Triage'] });
    expect(d.selectSkill).toHaveBeenCalledWith('c1', 'cs2', false);
    expect(d.selectSkill).not.toHaveBeenCalledWith('c1', 'cs1', false);
  });

  it('requires a problem choice before the outline step', async () => {
    await expect(advance(deps(), state({ step: 'problems' }))).rejects.toThrow(
      /Choose a problem/,
    );
  });

  it('selects the named problem then generates units', async () => {
    const d = deps({
      getCourse: vi.fn().mockResolvedValue({
        id: 'c1', status: 'INITIALIZING', CourseProblems: PROBLEMS,
      }),
    });
    const { produced } = await advance(d, state({ step: 'problems' }), {
      selectProblem: 'Breach',
    });
    expect(d.selectProblem).toHaveBeenCalledWith('c1', 'p2', true);
    expect(produced).toEqual({ kind: 'outline', units: [{ id: 'u1', title: 'Unit 1' }] });
  });

  it('throws on an ambiguous problem name instead of guessing', async () => {
    const d = deps({
      getCourse: vi.fn().mockResolvedValue({
        id: 'c1',
        status: 'INITIALIZING',
        CourseProblems: [
          { id: 'p3', title: 'Outage - Regional', isSelected: false },
          { id: 'p4', title: 'Outage - Global', isSelected: false },
        ],
      }),
    });
    await expect(
      advance(d, state({ step: 'problems' }), { selectProblem: 'Outage' }),
    ).rejects.toThrow(/matches more than one/);
    expect(d.selectProblem).not.toHaveBeenCalled();
  });

  it('labels an untitled problem "(untitled)" in the no-match error, never leaking its id', async () => {
    const d = deps({
      getCourse: vi.fn().mockResolvedValue({
        id: 'c1',
        status: 'INITIALIZING',
        CourseProblems: [{ id: 'p9-secret-uuid', title: undefined, isSelected: false }],
      }),
    });
    let error: Error | undefined;
    try {
      await advance(d, state({ step: 'problems' }), { selectProblem: 'nonexistent' });
    } catch (err) {
      error = err as Error;
    }
    expect(error?.message).toMatch(/\(untitled\)/);
    expect(error?.message).not.toContain('p9-secret-uuid');
  });

  it('requires emails at the invite gate', async () => {
    await expect(advance(deps(), state({ step: 'publish' }))).rejects.toThrow(
      /No email addresses/,
    );
  });

  it('publishes then invites across two gates', async () => {
    const d = deps();
    let s = state({ step: 'detail' });
    ({ state: s } = await advance(d, s));
    expect(d.publish).toHaveBeenCalledWith('c1');
    expect(s.step).toBe('publish');

    ({ state: s } = await advance(d, s, { emails: ['x@y.z'] }));
    expect(d.invite).toHaveBeenCalledWith('c1', ['x@y.z']);
    expect(s.step).toBe('invite');
  });

});

describe('assertRevisable', () => {
  it('allows revising the current step', () => {
    expect(() => assertRevisable(state({ step: 'skills' }), 'skills')).not.toThrow();
  });

  it('blocks upstream steps once the outline exists', () => {
    expect(() => assertRevisable(state({ step: 'detail' }), 'skills')).toThrow(
      /frozen once the outline is generated/,
    );
  });

  it('freezes upstream steps as soon as the outline step is reached', () => {
    expect(() => assertRevisable(state({ step: 'outline' }), 'skills')).toThrow(
      /frozen once the outline is generated/,
    );
  });

  it('freezes context as soon as the outline step is reached', () => {
    expect(() => assertRevisable(state({ step: 'outline' }), 'context')).toThrow(
      /frozen once the outline is generated/,
    );
  });

  it('freezes problems as soon as the outline step is reached', () => {
    expect(() => assertRevisable(state({ step: 'outline' }), 'problems')).toThrow(
      /frozen once the outline is generated/,
    );
  });

  it('names the three frozen steps in the error', () => {
    expect(() => assertRevisable(state({ step: 'publish' }), 'context')).toThrow(
      /context, skills and problems/,
    );
  });

  it('still allows revising the outline after it exists', () => {
    expect(() => assertRevisable(state({ step: 'detail' }), 'outline')).not.toThrow();
  });
});
