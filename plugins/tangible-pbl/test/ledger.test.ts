import { describe, it, expect } from 'vitest';
import { renderLedger, renderGate, courseUrl } from '../src/session/ledger.js';
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

  it('states the known publish limitation at the detail gate', () => {
    const out = renderGate(state({ step: 'detail' }), {
      appUrl: 'https://x',
      produced: { kind: 'none' },
    });
    expect(out).toContain('pbl_publish');
    expect(out).toContain('400');
    expect(out).toMatch(/detail layer/);
  });

  it('does not state the publish limitation at other gates', () => {
    const out = renderGate(state({ step: 'outline' }), {
      appUrl: 'https://x',
      produced: { kind: 'outline', units: [] },
    });
    expect(out).not.toMatch(/detail layer/);
  });
});
