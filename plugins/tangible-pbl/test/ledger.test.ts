import { describe, it, expect } from 'vitest';
import { renderLedger, renderGate, courseUrl, renderBreakdown } from '../src/session/ledger.js';
import type { CourseMemory } from '../src/session/memory.js';

const state = (over: Partial<CourseMemory> = {}): CourseMemory => ({
  id: 's1', title: 'brief', env: 'staging', courseId: 'c1',
  businessName: 'Acme', brief: 'brief', step: 'skills',
  awaitingApproval: true, status: 'active',
  created: '2026-08-05T10:00:00.000Z', updated: '2026-08-05T10:00:00.000Z',
  ...over,
});

describe('courseUrl', () => {
  it('builds the business course URL', () => {
    expect(courseUrl('https://app.tangible.careers/', 'c1')).toBe(
      'https://app.tangible.careers/business/problem-based-learning/courses/c1',
    );
  });
});

describe('renderLedger', () => {
  it('marks completed, current and pending steps', () => {
    const out = renderLedger(state());
    expect(out).toContain('✓ context');
    expect(out).toContain('✓ skills');
    expect(out).toContain('○ problems');
  });
});

describe('renderGate', () => {
  it('shouts the environment in production', () => {
    const out = renderGate(state({ env: 'production' }), {
      appUrl: 'https://app.tangible.careers',
      produced: { kind: 'none' },
    });
    expect(out).toContain('PRODUCTION');
    expect(out).not.toContain('production —');
  });

  it('states staging quietly', () => {
    const out = renderGate(state(), {
      appUrl: 'https://tg-dev.netlify.app',
      produced: { kind: 'none' },
    });
    expect(out).toContain('staging');
    expect(out).not.toContain('PRODUCTION');
  });

  it('names the business and the review URL', () => {
    const out = renderGate(state(), {
      appUrl: 'https://tg-dev.netlify.app',
      produced: { kind: 'none' },
    });
    expect(out).toContain('Acme');
    expect(out).toContain(
      'https://tg-dev.netlify.app/business/problem-based-learning/courses/c1',
    );
  });

  it('lists generated skills by name, never by id', () => {
    const out = renderGate(state(), {
      appUrl: 'https://x',
      produced: {
        kind: 'skills',
        skills: [
          { id: 'cs1', isSelected: true, CoreCompetencyModel: { id: 'm1', name: 'Triage' } },
          { id: 'cs2', isSelected: false, CoreCompetencyModel: { id: 'm2', name: 'Comms' } },
        ],
      },
    });
    expect(out).toContain('Triage');
    expect(out).toContain('Comms');
    expect(out).not.toContain('cs1');
    expect(out).not.toContain('m1');
  });

  it('lists outline units in order', () => {
    const out = renderGate(state({ step: 'outline' }), {
      appUrl: 'https://x',
      produced: { kind: 'outline', units: [{ id: 'u1', title: 'Intro' }, { id: 'u2', title: 'Deep dive' }] },
    });
    expect(out).toMatch(/1\. Intro[\s\S]*2\. Deep dive/);
    expect(out).not.toContain('u1');
  });

  it('says what happens next', () => {
    const out = renderGate(state(), { appUrl: 'https://x', produced: { kind: 'none' } });
    expect(out).toContain('pbl_approve');
    expect(out).toContain('problems');
  });

  it('lists generated problems by title, never by id', () => {
    const out = renderGate(state({ step: 'problems' }), {
      appUrl: 'https://x',
      produced: {
        kind: 'problems',
        problems: [
          { id: 'p1', title: 'Escalation scenario' },
          { id: 'p2', title: 'Time pressure case' },
        ],
      },
    });
    expect(out).toContain('Escalation scenario');
    expect(out).toContain('Time pressure case');
    expect(out).toMatch(/1\. Escalation[\s\S]*2\. Time pressure/);
    expect(out).not.toContain('p1');
    expect(out).not.toContain('p2');
  });

  it('uses fallback (untitled) for problems without title, never renders id', () => {
    const out = renderGate(state({ step: 'problems' }), {
      appUrl: 'https://x',
      produced: {
        kind: 'problems',
        problems: [
          { id: 'p1', title: 'Documented case' },
          { id: 'p2', title: undefined },
        ],
      },
    });
    expect(out).toContain('Documented case');
    expect(out).toContain('(untitled)');
    expect(out).toMatch(/1\. Documented[\s\S]*2\. \(untitled\)/);
    expect(out).not.toContain('p1');
    expect(out).not.toContain('p2');
  });

  it('terminates with pbl_abort when at done step', () => {
    const out = renderGate(state({ step: 'done' }), {
      appUrl: 'https://x',
      produced: { kind: 'none' },
    });
    expect(out).toContain('pbl_abort');
    expect(out).not.toContain('pbl_approve');
  });

  it('renders published status', () => {
    const out = renderGate(state(), {
      appUrl: 'https://x',
      produced: { kind: 'published' },
    });
    expect(out).toContain('Course published.');
  });

  it('renders invitations sent with singular/plural', () => {
    const outSingular = renderGate(state(), {
      appUrl: 'https://x',
      produced: { kind: 'invited', count: 1 },
    });
    expect(outSingular).toContain('Invitations sent to 1 learner.');

    const outPlural = renderGate(state(), {
      appUrl: 'https://x',
      produced: { kind: 'invited', count: 5 },
    });
    expect(outPlural).toContain('Invitations sent to 5 learners.');
  });

  it('renders empty skills collection', () => {
    const out = renderGate(state(), {
      appUrl: 'https://x',
      produced: { kind: 'skills', skills: [] },
    });
    expect(out).toContain('No skills were generated.');
  });

  it('renders empty problems collection', () => {
    const out = renderGate(state({ step: 'problems' }), {
      appUrl: 'https://x',
      produced: { kind: 'problems', problems: [] },
    });
    expect(out).toContain('No problems were generated.');
  });

  it('renders empty outline collection', () => {
    const out = renderGate(state({ step: 'outline' }), {
      appUrl: 'https://x',
      produced: { kind: 'outline', units: [] },
    });
    expect(out).toContain('No content units were generated.');
  });

  // The detail gate used to append a "pbl_publish will 400" limitation
  // notice, back when 'detail' was a no-op that created nothing. Now that
  // reaching this step means the gate that advanced into it just created the
  // sub-units, that notice would be actively wrong — it must stay gone.
  it('no longer states the old publish limitation at the detail gate', () => {
    const out = renderGate(state({ step: 'detail' }), {
      appUrl: 'https://x',
      produced: { kind: 'none' },
    });
    expect(out).not.toMatch(/detail layer/);
    expect(out).not.toContain('pbl_publish');
  });

  // Produced's 'detail' variant carries only names (contentUnitTitle, title,
  // skill names) — never an id field — so there is no fixture that could make
  // a "not.toContain(id)" assertion here meaningful; the real no-id guarantee
  // against realistic API shapes (cu1/su1/ccm1/lvl1 present in the fixture) is
  // exercised end-to-end in tools.test.ts's "creates the breakdown..." test.
  it('lists created sub-content units by name, grouped under their content unit', () => {
    const out = renderGate(state({ step: 'detail' }), {
      appUrl: 'https://x',
      produced: {
        kind: 'detail',
        created: [
          { contentUnitTitle: 'Module One', title: 'Lesson A', skills: ['Triage'] },
          { contentUnitTitle: 'Module Two', title: 'Lesson B', skills: ['Comms', 'Escalation'] },
        ],
      },
    });
    expect(out).toContain('Module One › Lesson A [Triage]');
    expect(out).toContain('Module Two › Lesson B [Comms, Escalation]');
  });

  it('renders empty detail collection', () => {
    const out = renderGate(state({ step: 'detail' }), {
      appUrl: 'https://x',
      produced: { kind: 'detail', created: [] },
    });
    expect(out).toContain('No sub-content units were created.');
  });

  it('renders generated artifact count with no failures', () => {
    const out = renderGate(state({ step: 'artifacts' }), {
      appUrl: 'https://x',
      produced: { kind: 'artifacts', generated: ['Lesson A', 'Lesson B'], failed: [] },
    });
    expect(out).toContain('Artifacts: 2 generated.');
    expect(out).not.toContain('failed');
  });

  it('lists artifact failures by title and reason, alongside the generated count', () => {
    const out = renderGate(state({ step: 'artifacts' }), {
      appUrl: 'https://x',
      produced: {
        kind: 'artifacts',
        generated: ['Lesson A'],
        failed: [{ title: 'Lesson B', reason: 'upstream exploded' }],
      },
    });
    expect(out).toContain('Artifacts: 1 generated.');
    expect(out).toContain('1 failed:');
    expect(out).toContain('Lesson B — upstream exploded');
  });
});

describe('renderBreakdown', () => {
  it('lists content units and sub-units, with named skills in brackets', () => {
    const out = renderBreakdown([
      {
        title: 'Module One',
        subs: [
          { title: 'Lesson A', skills: [{ coreCompetencyModelId: 'ccm1', name: 'Visual Hierarchy' }] },
        ],
      },
    ]);
    expect(out).toContain('Module One');
    expect(out).toContain('Lesson A [Visual Hierarchy]');
    expect(out).not.toContain('ccm1');
  });

  it('renders a sub-unit with no skills as just its title', () => {
    const out = renderBreakdown([
      { title: 'Module One', subs: [{ title: 'Lesson A', skills: [] }] },
    ]);
    expect(out).toContain('Lesson A');
    expect(out).not.toContain('[');
  });

  // Regression guard: SubUnitSkill.name is optional — the backend can return
  // a skill with only a bare coreCompetencyModelId. Rendering that id would
  // be a UUID leak. The fixture below makes the forbidden id reachable (the
  // skill genuinely has no name), so this test actually exercises the
  // fallback rather than passing vacuously — see CLAUDE.md's testing lessons
  // on why a reachable fixture is required for a negative assertion to mean
  // anything.
  it('never renders a bare coreCompetencyModelId — falls back to a skill count', () => {
    const out = renderBreakdown([
      {
        title: 'Module One',
        subs: [{ title: 'Lesson A', skills: [{ coreCompetencyModelId: 'ccm-secret-uuid' }] }],
      },
    ]);
    expect(out).toContain('Lesson A (1 skill)');
    expect(out).not.toContain('ccm-secret-uuid');
  });

  it('falls back to a count for the whole sub-unit when only some of its skills are named', () => {
    const out = renderBreakdown([
      {
        title: 'Module One',
        subs: [{
          title: 'Lesson A',
          skills: [
            { coreCompetencyModelId: 'ccm1', name: 'Visual Hierarchy' },
            { coreCompetencyModelId: 'ccm-secret-uuid' },
          ],
        }],
      },
    ]);
    expect(out).toContain('Lesson A (2 skills)');
    expect(out).not.toContain('ccm-secret-uuid');
    expect(out).not.toContain('Visual Hierarchy');
  });

  it('returns an empty string for no content units, so pbl_status appends nothing', () => {
    expect(renderBreakdown([])).toBe('');
  });
});
