import { describe, it, expect } from 'vitest';
import { planSubUnits, type SubUnitSpec } from '../src/session/detail-plan.js';
import type { ContentUnit, CourseSkill } from '../src/api/builder.js';

const units: ContentUnit[] = [
  { id: 'cu1', title: 'Seeing Before Styling' },
  { id: 'cu2', title: 'Type as a System' },
];

const skill = (name: string, over: Partial<CourseSkill> = {}): CourseSkill => ({
  id: `cs-${name}`,
  isSelected: true,
  CoreCompetencyModel: { id: `ccm-${name}`, name },
  Level: { id: `lvl-${name}`, name: 'Foundational' },
  ...over,
});

const skills: CourseSkill[] = [
  skill('Visual Hierarchy'),
  skill('Typographic Systems'),
  skill('Critique'),
];

const spec = (over: Partial<SubUnitSpec> = {}): SubUnitSpec => ({
  contentUnit: 'Seeing Before Styling',
  title: 'What UI and UX each decide',
  skills: ['Visual Hierarchy'],
  ...over,
});

describe('planSubUnits', () => {
  it('resolves content unit and skill names to ids', () => {
    const [r] = planSubUnits([spec()], units, skills);
    expect(r!.contentUnitId).toBe('cu1');
    expect(r!.contentUnitTitle).toBe('Seeing Before Styling');
    expect(r!.skills).toEqual([
      { coreCompetencyModelId: 'ccm-Visual Hierarchy', levelId: 'lvl-Visual Hierarchy', name: 'Visual Hierarchy' },
    ]);
  });

  it('maps minutes to estimatedDuration and omits absent optionals', () => {
    const [r] = planSubUnits([spec({ minutes: 45, description: 'why' })], units, skills);
    expect(r!.estimatedDuration).toBe(45);
    expect(r!.description).toBe('why');
    const [bare] = planSubUnits([spec()], units, skills);
    // toBeUndefined() alone cannot tell "key absent" from "key present with
    // value undefined" — 'in' is what actually proves omission.
    expect('estimatedDuration' in bare!).toBe(false);
    expect('description' in bare!).toBe(false);
  });

  it('resolves a content unit by unique prefix', () => {
    expect(planSubUnits([spec({ contentUnit: 'Type as' })], units, skills)[0]!.contentUnitId)
      .toBe('cu2');
  });

  it('rejects an unknown content unit, naming what is available', () => {
    expect(() => planSubUnits([spec({ contentUnit: 'Nope' })], units, skills))
      .toThrow(/No content unit matching "Nope".*Seeing Before Styling/s);
  });

  it('rejects an unknown skill, naming what is available', () => {
    expect(() => planSubUnits([spec({ skills: ['Nope'] })], units, skills))
      .toThrow(/No skill matching "Nope".*Visual Hierarchy/s);
  });

  it('rejects a sub-unit with no skills — publish requires at least one', () => {
    expect(() => planSubUnits([spec({ skills: [] })], units, skills))
      .toThrow(/"What UI and UX each decide".*at least one skill/s);
  });

  it('rejects more than ten skills on one sub-unit', () => {
    const many = Array.from({ length: 11 }, (_, i) => skill(`S${i}`));
    expect(() =>
      planSubUnits([spec({ skills: many.map((s) => s.CoreCompetencyModel.name) })], units, many),
    ).toThrow(/ten skills/);
  });

  it('accepts exactly ten skills — the boundary itself', () => {
    const ten = Array.from({ length: 10 }, (_, i) => skill(`S${i}`));
    expect(
      planSubUnits([spec({ skills: ten.map((s) => s.CoreCompetencyModel.name) })], units, ten)[0]!
        .skills,
    ).toHaveLength(10);
  });

  it('rejects a skill with no Level, naming it, when the other selected skills do carry one', () => {
    // Mixed case: only one of three selected skills lacks a level. This must
    // stay the per-skill message — the systemic message below is reserved
    // for when *every* selected skill lacks one.
    const mixed = [
      skill('Visual Hierarchy', { Level: undefined }),
      skill('Typographic Systems'),
      skill('Critique'),
    ];
    expect(() => planSubUnits([spec()], units, mixed))
      .toThrow(/Visual Hierarchy.*no level/s);
  });

  it('rejects with a systemic message when every selected skill lacks a level', () => {
    // If CourseSkill has no Level field at all (a response-shape mismatch —
    // see CLAUDE.md), every selected skill lacks one and the per-skill
    // message would send an operator through every skill in the course
    // before suspecting the client. This must name the count and point at
    // the client, not blame the first skill in the list.
    const allNoLevel = [
      skill('Visual Hierarchy', { Level: undefined }),
      skill('Typographic Systems', { Level: undefined }),
      skill('Critique', { Level: undefined }),
    ];
    expect(() => planSubUnits([spec()], units, allNoLevel))
      .toThrow(/None of the 3 selected skills carries a level/);
  });

  it('still raises the systemic message when an unselected skill happens to carry a level', () => {
    // Guards against a broken predicate that checks courseSkills.every(...)
    // over the full list instead of selected.every(...) — an unselected
    // skill that happens to carry a level must not mask a systemic problem
    // among the selected skills. With the buggy full-list check, this
    // fixture's one selected+level-less skill would be masked by the
    // unselected+leveled one and fall through to the old per-skill message
    // instead.
    const mixed = [
      skill('Visual Hierarchy', { Level: undefined }),
      skill('Unselected With Level', { isSelected: false }),
    ];
    expect(() => planSubUnits([spec()], units, mixed))
      .toThrow(/None of the 1 selected skills carries a level/);
  });

  it('only considers selected skills', () => {
    const unselected = [skill('Visual Hierarchy', { isSelected: false })];
    expect(() => planSubUnits([spec()], units, unselected)).toThrow(/No skill matching/);
  });

  it('rejects an empty breakdown', () => {
    expect(() => planSubUnits([], units, skills)).toThrow(/at least one sub-content unit/);
  });

  it('rejects a blank title', () => {
    expect(() => planSubUnits([spec({ title: '   ' })], units, skills)).toThrow(/title/);
  });

  it('rejects minutes that are zero, negative or fractional', () => {
    for (const minutes of [0, -5, 2.5]) {
      expect(() => planSubUnits([spec({ minutes })], units, skills))
        .toThrow(/whole number of minutes/);
    }
  });

  it('rejects minutes above the backend ceiling of 60000', () => {
    expect(() => planSubUnits([spec({ minutes: 60001 })], units, skills)).toThrow(/60000/);
  });

  it('accepts minutes at exactly the backend ceiling of 60000 — the boundary itself', () => {
    expect(planSubUnits([spec({ minutes: 60000 })], units, skills)[0]!.estimatedDuration)
      .toBe(60000);
  });

  it('rejects two sub-content units named the same thing under one content unit', () => {
    // pbl_add_resource resolves a sub-unit by name; a second sub-unit with
    // the same title under the same content unit makes that lookup
    // permanently ambiguous, and there is no rename/delete/reorder route to
    // recover afterward.
    expect(() =>
      planSubUnits(
        [spec({ title: 'Intro' }), spec({ title: 'Intro' })],
        units,
        skills,
      ),
    ).toThrow(/Seeing Before Styling.*two sub-content units named "Intro"/s);
  });

  it('treats title collisions case-insensitively and after trimming', () => {
    expect(() =>
      planSubUnits(
        [spec({ title: 'Intro' }), spec({ title: '  INTRO  ' })],
        units,
        skills,
      ),
    ).toThrow(/two sub-content units/);
  });

  it('allows the same title under two different content units', () => {
    expect(() =>
      planSubUnits(
        [spec({ title: 'Intro' }), spec({ contentUnit: 'Type as a System', title: 'Intro' })],
        units,
        skills,
      ),
    ).not.toThrow();
  });

  it('never puts an id in a validation error', () => {
    const cases: (() => unknown)[] = [
      () => planSubUnits([spec({ contentUnit: 'Nope' })], units, skills),
      () => planSubUnits([spec({ skills: ['Nope'] })], units, skills),
      () => planSubUnits([spec({ skills: [] })], units, skills),
      () => planSubUnits([spec()], units, [skill('Visual Hierarchy', { Level: undefined })]),
    ];
    for (const run of cases) {
      try {
        run();
        throw new Error('expected a validation failure');
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).not.toMatch(/cu1|cu2|ccm-|lvl-|cs-/);
      }
    }
  });
});
