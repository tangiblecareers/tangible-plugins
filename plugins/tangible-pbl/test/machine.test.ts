import { describe, it, expect, vi } from 'vitest';
import { advance, assertRevisable, nextStep, STEP_ORDER } from '../src/session/machine.js';
import type { MachineDeps } from '../src/session/machine.js';
import type { CourseMemory } from '../src/session/memory.js';
import { createHttpClient } from '../src/http.js';

const state = (over: Partial<CourseMemory> = {}): CourseMemory => ({
  id: 's1', title: 'Intro', env: 'staging', courseId: 'c1',
  businessName: 'Acme', brief: 'brief', step: 'context',
  awaitingApproval: true, status: 'active',
  created: '2026-08-05T10:00:00.000Z', updated: '2026-08-05T10:00:00.000Z', ...over,
});

const SKILLS = [
  {
    id: 'cs1', isSelected: true,
    CoreCompetencyModel: { id: 'm1', name: 'Triage' },
    Level: { id: 'lvl1', name: 'Foundational' },
  },
  {
    id: 'cs2', isSelected: true,
    CoreCompetencyModel: { id: 'm2', name: 'Comms' },
    Level: { id: 'lvl2', name: 'Foundational' },
  },
];
const PROBLEMS = [
  { id: 'p1', title: 'Outage', isSelected: false },
  { id: 'p2', title: 'Breach', isSelected: false },
];
const UNITS = [{ id: 'u1', title: 'Unit 1' }];

const deps = (over: Partial<Parameters<typeof advance>[0]> = {}) => ({
  generateSkills: vi.fn().mockResolvedValue({ id: 'c1', status: 'INITIALIZING', CourseSkills: SKILLS }),
  generateProblems: vi.fn().mockResolvedValue({ id: 'c1', status: 'INITIALIZING', CourseProblems: PROBLEMS }),
  generateContentUnits: vi.fn().mockResolvedValue(UNITS),
  getCourse: vi.fn().mockResolvedValue({
    id: 'c1', status: 'DRAFT', CourseSkills: SKILLS, CourseProblems: PROBLEMS,
  }),
  selectSkill: vi.fn().mockResolvedValue({ id: 'c1', status: 'INITIALIZING' }),
  selectProblem: vi.fn().mockResolvedValue({ id: 'c1', status: 'INITIALIZING' }),
  listContentUnits: vi.fn().mockResolvedValue(UNITS),
  createSubUnit: vi.fn().mockImplementation((_c: string, _cu: string, v: { title: string }) =>
    Promise.resolve({ id: `su-${v.title}`, title: v.title })),
  assignSkill: vi.fn().mockResolvedValue({}),
  listSubUnits: vi.fn().mockResolvedValue([]),
  generateArtifact: vi.fn().mockResolvedValue({}),
  publish: vi.fn().mockResolvedValue({ id: 'c1', status: 'PUBLISHED' }),
  invite: vi.fn().mockResolvedValue({}),
  ...over,
});

describe('STEP_ORDER', () => {
  it('matches the builder pipeline', () => {
    expect(STEP_ORDER).toEqual([
      'context', 'skills', 'problems', 'outline', 'detail', 'artifacts',
      'publish', 'invite', 'done',
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
    const input = {
      selectProblem: 'p1',
      subUnits: [{ contentUnit: 'Unit 1', title: 'Lesson', skills: ['Triage'] }],
    };
    for (const expected of ['skills', 'problems', 'outline', 'detail']) {
      ({ state: s } = await advance(d, s, input));
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
    let s = state({ step: 'artifacts' });
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

describe('advance to detail', () => {
  const units = [{ id: 'cu1', title: 'Module One' }];
  const skills = [{
    id: 'cs1', isSelected: true,
    CoreCompetencyModel: { id: 'ccm1', name: 'Visual Hierarchy' },
    Level: { id: 'lvl1', name: 'Foundational' },
  }];

  const detailDeps = (over: Partial<MachineDeps> = {}): MachineDeps => ({
    ...deps(),
    listContentUnits: vi.fn().mockResolvedValue(units),
    getCourse: vi.fn().mockResolvedValue({ id: 'c1', status: 'DRAFT', CourseSkills: skills }),
    createSubUnit: vi.fn().mockImplementation((_c, _cu, v) =>
      Promise.resolve({ id: `su-${v.title}`, title: v.title })),
    assignSkill: vi.fn().mockResolvedValue({}),
    ...over,
  });

  const input = {
    subUnits: [{
      contentUnit: 'Module One',
      title: 'Lesson A',
      minutes: 45,
      skills: ['Visual Hierarchy'],
    }],
  };

  it('creates each sub-unit and assigns its skills', async () => {
    const d = detailDeps();
    const { state: s, produced } = await advance(d, state({ step: 'outline' }), input);
    expect(s.step).toBe('detail');
    expect(d.createSubUnit).toHaveBeenCalledWith('c1', 'cu1', {
      title: 'Lesson A', estimatedDuration: 45,
    });
    expect(d.assignSkill).toHaveBeenCalledWith('c1', 'cu1', 'su-Lesson A', {
      coreCompetencyModelId: 'ccm1', levelId: 'lvl1',
    });
    expect(produced).toEqual({
      kind: 'detail',
      created: [{ contentUnitTitle: 'Module One', title: 'Lesson A', skills: ['Visual Hierarchy'] }],
    });
  });

  it('refuses to advance without a breakdown', async () => {
    await expect(advance(detailDeps(), state({ step: 'outline' }), {}))
      .rejects.toThrow(/subUnits/);
    // An empty array is truthy, so the `{}` case above alone cannot catch a
    // regression from `.subUnits?.length` to a bare `!input.subUnits` check.
    // This must be asserted explicitly.
    await expect(advance(detailDeps(), state({ step: 'outline' }), { subUnits: [] }))
      .rejects.toThrow(/subUnits/);
  });

  it('writes nothing when validation fails', async () => {
    const d = detailDeps();
    await expect(
      advance(d, state({ step: 'outline' }), {
        subUnits: [{ contentUnit: 'Nope', title: 'A', skills: ['Visual Hierarchy'] }],
      }),
    ).rejects.toThrow(/No content unit matching/);
    // The whole point of validating first: a bad name in the breakdown must not
    // leave half of it created.
    expect(d.createSubUnit).not.toHaveBeenCalled();
    expect(d.assignSkill).not.toHaveBeenCalled();
  });

  it('validates every entry before creating any of them', async () => {
    const d = detailDeps();
    await expect(
      advance(d, state({ step: 'outline' }), {
        subUnits: [
          { contentUnit: 'Module One', title: 'Good', skills: ['Visual Hierarchy'] },
          { contentUnit: 'Module One', title: 'Bad', skills: ['Unknown'] },
        ],
      }),
    ).rejects.toThrow(/No skill matching "Unknown"/);
    expect(d.createSubUnit).not.toHaveBeenCalled();
  });
});

describe('advance to artifacts', () => {
  const units = [{ id: 'cu1', title: 'Module One' }];
  const subs = [{ id: 'su1', title: 'Lesson A' }, { id: 'su2', title: 'Lesson B' }];

  const artifactDeps = (over: Partial<MachineDeps> = {}): MachineDeps => ({
    ...deps(),
    listContentUnits: vi.fn().mockResolvedValue(units),
    listSubUnits: vi.fn().mockResolvedValue(subs),
    generateArtifact: vi.fn().mockResolvedValue({}),
    ...over,
  });

  it('generates one artifact per sub-unit', async () => {
    const d = artifactDeps();
    const { state: s, produced } = await advance(d, state({ step: 'detail' }), {});
    expect(s.step).toBe('artifacts');
    expect(d.generateArtifact).toHaveBeenCalledTimes(2);
    expect(produced).toEqual({ kind: 'artifacts', generated: ['Lesson A', 'Lesson B'], failed: [] });
  });

  it('passes the instruction to every call', async () => {
    const d = artifactDeps();
    await advance(d, state({ step: 'detail' }), { instruction: 'keep it practical' });
    // Guard the loop below with a call-count assertion first — a loop over
    // zero calls would otherwise pass vacuously if generateArtifact were
    // never invoked at all.
    expect(d.generateArtifact).toHaveBeenCalledTimes(2);
    for (const call of (d.generateArtifact as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[3]).toEqual({ instruction: 'keep it practical' });
    }
  });

  it('counts a 409 as already satisfied, not a failure', async () => {
    const conflict = Object.assign(new Error('artifact exists'), { status: 409 });
    const d = artifactDeps({
      generateArtifact: vi.fn()
        .mockRejectedValueOnce(conflict)
        .mockResolvedValueOnce({}),
    });
    const { produced } = await advance(d, state({ step: 'detail' }), {});
    expect(d.generateArtifact).toHaveBeenCalledTimes(2);
    expect(produced).toEqual({ kind: 'artifacts', generated: ['Lesson A', 'Lesson B'], failed: [] });
  });

  it('continues past a failure and reports both lists', async () => {
    const d = artifactDeps({
      generateArtifact: vi.fn()
        .mockRejectedValueOnce(new Error('upstream exploded'))
        .mockResolvedValueOnce({}),
    });
    const { produced } = await advance(d, state({ step: 'detail' }), {});
    // Aborting on the first failure would discard the second generation and
    // leave no way to resume mid-gate.
    expect(d.generateArtifact).toHaveBeenCalledTimes(2);
    expect(produced).toEqual({
      kind: 'artifacts',
      generated: ['Lesson B'],
      failed: [{ title: 'Lesson A', reason: 'upstream exploded' }],
    });
  });

  it('advances even when every artifact fails, so the gate is not a dead end', async () => {
    const d = artifactDeps({
      generateArtifact: vi.fn().mockRejectedValue(new Error('nope')),
    });
    const { state: s, produced } = await advance(d, state({ step: 'detail' }), {});
    expect(s.step).toBe('artifacts');
    expect(d.generateArtifact).toHaveBeenCalledTimes(2);
    expect((produced as { generated: string[]; failed: { title: string; reason: string }[] }).generated).toEqual([]);
    expect((produced as { generated: string[]; failed: { title: string; reason: string }[] }).failed).toHaveLength(2);
  });

  // Regression: a TangibleApiError's message is the backend's own free text,
  // and the backend can embed a sub-unit or course id directly in it (e.g. a
  // not-found or duplicate-resource error). Route the rejection through the
  // real http.ts so this pins the actual production chain — redaction lives
  // in http.ts, not in machine.ts's catch — rather than asserting against a
  // hand-built error that was never at risk of carrying an id in the first
  // place.
  it('never lets a UUID embedded in the backend message reach failed[].reason', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message: 'Sub-unit 8f14e45f-ceea-467a-9f0e-0d0a0d0a0d0a not found' }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      ),
    );
    const http = createHttpClient('https://api.test/v1', fetchImpl);
    const rejection = await http
      .request({ method: 'POST', path: 'x' })
      .catch((e: unknown) => e);

    const d = artifactDeps({
      generateArtifact: vi.fn()
        .mockRejectedValueOnce(rejection)
        .mockResolvedValueOnce({}),
    });
    const { produced } = await advance(d, state({ step: 'detail' }), {});
    const failed = (produced as { failed: { title: string; reason: string }[] }).failed;
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toContain('not found');
    expect(failed[0]!.reason).not.toContain('8f14e45f');
  });
});
