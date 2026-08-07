import { describe, it, expect } from 'vitest';
import { planSubUnits, type SubUnitSpec } from '../src/session/detail-plan.js';
import type { CompetencyLevel } from '../src/api/competency.js';
import type { ContentUnit, CourseSkill } from '../src/api/builder.js';

const units: ContentUnit[] = [
  { id: 'cu1', title: 'Seeing Before Styling' },
  { id: 'cu2', title: 'Type as a System' },
];

const skill = (name: string, over: Partial<CourseSkill> = {}): CourseSkill => ({
  id: `cs-${name}`,
  isSelected: true,
  CoreCompetencyModel: { id: `ccm-${name}`, name },
  ...over,
});

const skills: CourseSkill[] = [
  skill('Visual Hierarchy'),
  skill('Typographic Systems'),
  skill('Critique'),
];

/** One default (single) level per skill, keyed by its competency id. */
const levelsFor = (
  skillList: CourseSkill[],
  levels: (s: CourseSkill) => CompetencyLevel[] = (s) => [
    { id: `lvl-${s.CoreCompetencyModel.name}`, name: 'Foundational' },
  ],
): Map<string, CompetencyLevel[]> =>
  new Map(skillList.map((s) => [s.CoreCompetencyModel.id, levels(s)]));

const levels = levelsFor(skills);

const spec = (over: Partial<SubUnitSpec> = {}): SubUnitSpec => ({
  contentUnit: 'Seeing Before Styling',
  title: 'What UI and UX each decide',
  skills: [{ name: 'Visual Hierarchy' }],
  ...over,
});

describe('planSubUnits', () => {
  it('resolves content unit and skill names to ids', () => {
    const [r] = planSubUnits([spec()], units, skills, levels);
    expect(r!.contentUnitId).toBe('cu1');
    expect(r!.contentUnitTitle).toBe('Seeing Before Styling');
    expect(r!.skills).toEqual([
      { coreCompetencyModelId: 'ccm-Visual Hierarchy', levelId: 'lvl-Visual Hierarchy', name: 'Visual Hierarchy' },
    ]);
  });

  it('maps minutes to estimatedDuration and omits absent optionals', () => {
    const [r] = planSubUnits([spec({ minutes: 45, description: 'why' })], units, skills, levels);
    expect(r!.estimatedDuration).toBe(45);
    expect(r!.description).toBe('why');
    const [bare] = planSubUnits([spec()], units, skills, levels);
    // toBeUndefined() alone cannot tell "key absent" from "key present with
    // value undefined" — 'in' is what actually proves omission.
    expect('estimatedDuration' in bare!).toBe(false);
    expect('description' in bare!).toBe(false);
  });

  it('resolves a content unit by unique prefix', () => {
    expect(planSubUnits([spec({ contentUnit: 'Type as' })], units, skills, levels)[0]!.contentUnitId)
      .toBe('cu2');
  });

  it('rejects an unknown content unit, naming what is available', () => {
    expect(() => planSubUnits([spec({ contentUnit: 'Nope' })], units, skills, levels))
      .toThrow(/No content unit matching "Nope".*Seeing Before Styling/s);
  });

  it('rejects an unknown skill, naming what is available', () => {
    expect(() => planSubUnits([spec({ skills: [{ name: 'Nope' }] })], units, skills, levels))
      .toThrow(/No skill matching "Nope".*Visual Hierarchy/s);
  });

  it('rejects a sub-unit with no skills — publish requires at least one', () => {
    expect(() => planSubUnits([spec({ skills: [] })], units, skills, levels))
      .toThrow(/"What UI and UX each decide".*at least one skill/s);
  });

  it('rejects more than ten skills on one sub-unit', () => {
    const many = Array.from({ length: 11 }, (_, i) => skill(`S${i}`));
    expect(() =>
      planSubUnits(
        [spec({ skills: many.map((s) => ({ name: s.CoreCompetencyModel.name })) })],
        units, many, levelsFor(many),
      ),
    ).toThrow(/ten skills/);
  });

  it('accepts exactly ten skills — the boundary itself', () => {
    const ten = Array.from({ length: 10 }, (_, i) => skill(`S${i}`));
    expect(
      planSubUnits(
        [spec({ skills: ten.map((s) => ({ name: s.CoreCompetencyModel.name })) })],
        units, ten, levelsFor(ten),
      )[0]!.skills,
    ).toHaveLength(10);
  });

  it('only considers selected skills', () => {
    const unselected = [skill('Visual Hierarchy', { isSelected: false })];
    expect(() => planSubUnits([spec()], units, unselected, new Map())).toThrow(/No skill matching/);
  });

  it('matches a level by name case-insensitively', () => {
    const twoLevels = new Map([
      ['ccm-Visual Hierarchy', [
        { id: 'lvl-f', name: 'Foundational' },
        { id: 'lvl-p', name: 'Proficient' },
      ]],
    ]);
    const [r] = planSubUnits(
      [spec({ skills: [{ name: 'Visual Hierarchy', level: 'proficient' }] })],
      units, skills, twoLevels,
    );
    expect(r!.skills[0]!.levelId).toBe('lvl-p');
  });

  it('uses the competency’s single level automatically when level is omitted', () => {
    // If this ever required an explicit level, omitting it here would throw.
    const oneLevel = new Map([['ccm-Visual Hierarchy', [{ id: 'lvl-only', name: 'Foundational' }]]]);
    const [r] = planSubUnits([spec()], units, skills, oneLevel);
    expect(r!.skills[0]!.levelId).toBe('lvl-only');
  });

  it('refuses to guess when the competency has more than one level and level is omitted', () => {
    // If this ever silently picked one instead of refusing, it would not throw.
    const twoLevels = new Map([
      ['ccm-Visual Hierarchy', [
        { id: 'lvl-f', name: 'Foundational' },
        { id: 'lvl-p', name: 'Proficient' },
      ]],
    ]);
    expect(() => planSubUnits([spec()], units, skills, twoLevels))
      .toThrow(/What UI and UX each decide.*Visual Hierarchy.*Foundational, Proficient/s);
  });

  it('rejects a level name that matches none of the competency’s levels', () => {
    const twoLevels = new Map([
      ['ccm-Visual Hierarchy', [
        { id: 'lvl-f', name: 'Foundational' },
        { id: 'lvl-p', name: 'Proficient' },
      ]],
    ]);
    expect(() =>
      planSubUnits(
        [spec({ skills: [{ name: 'Visual Hierarchy', level: 'Expert' }] })],
        units, skills, twoLevels,
      ),
    ).toThrow(/Visual Hierarchy.*no level named "Expert".*Foundational, Proficient/s);
  });

  it('rejects a skill whose competency has no levels at all, naming it and pointing at the app', () => {
    const noLevels = new Map([['ccm-Visual Hierarchy', []]]);
    expect(() => planSubUnits([spec()], units, skills, noLevels))
      .toThrow(/Visual Hierarchy.*no levels.*fixed in the app/s);
  });

  it('rejects an empty breakdown', () => {
    expect(() => planSubUnits([], units, skills, levels)).toThrow(/at least one sub-content unit/);
  });

  it('rejects a blank title', () => {
    expect(() => planSubUnits([spec({ title: '   ' })], units, skills, levels)).toThrow(/title/);
  });

  it('rejects minutes that are zero, negative or fractional', () => {
    for (const minutes of [0, -5, 2.5]) {
      expect(() => planSubUnits([spec({ minutes })], units, skills, levels))
        .toThrow(/whole number of minutes/);
    }
  });

  it('rejects minutes above the backend ceiling of 60000', () => {
    expect(() => planSubUnits([spec({ minutes: 60001 })], units, skills, levels)).toThrow(/60000/);
  });

  it('accepts minutes at exactly the backend ceiling of 60000 — the boundary itself', () => {
    expect(planSubUnits([spec({ minutes: 60000 })], units, skills, levels)[0]!.estimatedDuration)
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
        units, skills, levels,
      ),
    ).toThrow(/Seeing Before Styling.*two sub-content units named "Intro"/s);
  });

  it('treats title collisions case-insensitively and after trimming', () => {
    expect(() =>
      planSubUnits(
        [spec({ title: 'Intro' }), spec({ title: '  INTRO  ' })],
        units, skills, levels,
      ),
    ).toThrow(/two sub-content units/);
  });

  it('allows the same title under two different content units', () => {
    expect(() =>
      planSubUnits(
        [spec({ title: 'Intro' }), spec({ contentUnit: 'Type as a System', title: 'Intro' })],
        units, skills, levels,
      ),
    ).not.toThrow();
  });

  it('never puts an id in a validation error', () => {
    const noLevels = new Map([['ccm-Visual Hierarchy', []]]);
    const twoLevels = new Map([
      ['ccm-Visual Hierarchy', [
        { id: 'lvl-f', name: 'Foundational' },
        { id: 'lvl-p', name: 'Proficient' },
      ]],
    ]);
    const cases: (() => unknown)[] = [
      () => planSubUnits([spec({ contentUnit: 'Nope' })], units, skills, levels),
      () => planSubUnits([spec({ skills: [{ name: 'Nope' }] })], units, skills, levels),
      () => planSubUnits([spec({ skills: [] })], units, skills, levels),
      () => planSubUnits([spec()], units, skills, noLevels),
      () => planSubUnits([spec()], units, skills, twoLevels),
      () =>
        planSubUnits(
          [spec({ skills: [{ name: 'Visual Hierarchy', level: 'Nope' }] })],
          units, skills, twoLevels,
        ),
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
