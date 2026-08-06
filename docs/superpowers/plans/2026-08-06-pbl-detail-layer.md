# tangible-pbl Detail Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a course be driven from brief to publishable inside the plugin — sub-content units, skills on those sub-units, artifacts, and a reachable resource tool.

**Architecture:** A new `src/api/subunits.ts` owns the wire format for sub-units, sub-unit skills and artifacts. A pure `src/session/detail-plan.ts` validates and resolves a caller-supplied breakdown against the live course **before any write**. `machine.ts` gains an `artifacts` step and two new `advance` cases that consume the resolved plan through `MachineDeps`. The tools layer supplies input and renders results.

**Tech Stack:** TypeScript (ESM, NodeNext), vitest, zod for tool schemas. No new dependencies.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-06-pbl-detail-layer-design.md`. Read its "Backend contracts" table before writing any API call — every path and body there was read from backend source, not inferred.
- **No new dependencies.** The package depends on `@modelcontextprotocol/sdk` and `zod` and nothing else.
- **ESM with NodeNext:** every relative import needs the `.js` extension even though sources are `.ts`.
- **`advance()` keeps exactly two call sites — `pbl_approve` and `pbl_revise` — and moves exactly one step per invocation.** This is the product's entire premise. `test/machine.test.ts` enforces it.
- **`machine.ts` reaches the API only through `MachineDeps`.** Do not import API functions into it.
- **No UUID in any output, including error messages.** The one exception is `courseId` inside the review URL built by `ledger.ts`.
- **Validate before any write.** At the `detail` gate, every check runs and fails before the first sub-unit is created.
- **`estimatedDuration` is in minutes.** Positive integer, max 60000. Say "minutes" in every description and comment — an unlabelled "duration" ships as hours.
- **Ten skills maximum per sub-unit**, server-enforced. Validate locally first.
- **Conventional commits, scope `tangible-pbl`. No co-author trailers.**
- **Rebuild and commit `dist/` in every task that changes `src/`.** CI fails on a stale `dist/`. Get `npx tsc --noEmit` clean *before* `npm run build` — `tsconfig.json` has no `noEmitOnError`, so a failing build still emits a partial `dist/`.
- **Every new test is verified by breaking the code it covers and confirming it fails.** Four could-not-fail tests were caught during earlier work on this package; two shipped before that. A negative assertion only has force when the forbidden path is reachable in the fixture, and a boundary test must use the value *at* the boundary.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/api/subunits.ts` | Create | Wire format: sub-unit create/list, skill assign/list, artifact generate |
| `src/session/by-name.ts` | Create | `byName` moved out of `machine.ts` so two modules can share it without a third copy |
| `src/session/detail-plan.ts` | Create | Pure validation + name→id resolution of a caller-supplied breakdown |
| `src/session/machine.ts` | Modify | `STEP_ORDER` gains `artifacts`; `Produced` gains two kinds; two new `advance` cases; `MachineDeps` grows; `byName` re-exported from its new home |
| `src/session/ledger.ts` | Modify | Render the two new `Produced` kinds |
| `src/tools/session.ts` | Modify | `subUnits`/`instruction` inputs; sub-unit listing in `pbl_status`; log entries |
| `src/tools/direct.ts` | Modify | `pbl_add_resource` by name; `pbl_publish` precondition check |
| `test/subunits.test.ts` | Create | API module |
| `test/detail-plan.test.ts` | Create | Validation and resolution |

---

### Task 1: The sub-unit API module

**Files:**
- Create: `plugins/tangible-pbl/src/api/subunits.ts`
- Create: `plugins/tangible-pbl/test/subunits.test.ts`

**Interfaces:**
- Consumes: `call` from `./call.js`; `HttpClient`, `AuthManager` types.
- Produces:
  - `interface SubContentUnit { id: string; title: string; description?: string | null; estimatedDuration?: number | null; sortOrder?: number }`
  - `interface SubUnitSkill { coreCompetencyModelId: string; levelId?: string; name?: string }`
  - `createSubUnit(http, auth, courseId, contentUnitId, values: { title: string; description?: string; estimatedDuration?: number }): Promise<SubContentUnit>`
  - `listSubUnits(http, auth, courseId, contentUnitId): Promise<SubContentUnit[]>`
  - `assignSkill(http, auth, courseId, contentUnitId, subUnitId, body: { coreCompetencyModelId: string; levelId: string }): Promise<unknown>`
  - `generateArtifact(http, auth, courseId, contentUnitId, subUnitId, body?: { instruction?: string }): Promise<unknown>`

- [ ] **Step 1: Write the failing tests**

Create `plugins/tangible-pbl/test/subunits.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  createSubUnit, listSubUnits, assignSkill, generateArtifact,
} from '../src/api/subunits.js';
import { AuthManager } from '../src/auth.js';
import type { HttpClient } from '../src/http.js';

/** An auth manager already holding a business token, so calls go straight through. */
const ready = async () => {
  const request = vi.fn().mockResolvedValue({ token: 'biz', businessRole: 'ADMIN' });
  const auth = new AuthManager({ request } as unknown as HttpClient, {
    email: 'a@b.c', password: 'pw',
  });
  await auth.loginBusiness('b1', 'Acme');
  return auth;
};

const spyHttp = (result: unknown = {}) => {
  const request = vi.fn().mockResolvedValue(result);
  return { http: { request } as unknown as HttpClient, request };
};

describe('subunits api', () => {
  it('createSubUnit posts title, description and estimatedDuration', async () => {
    const { http, request } = spyHttp({ id: 'su1', title: 'Intro' });
    await createSubUnit(http, await ready(), 'c1', 'cu1', {
      title: 'Intro', description: 'why', estimatedDuration: 45,
    });
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: 'business/courses/c1/content-units/cu1/sub-content-units',
      token: 'biz',
      body: { title: 'Intro', description: 'why', estimatedDuration: 45 },
    });
  });

  it('createSubUnit omits absent optional fields rather than sending null', async () => {
    const { http, request } = spyHttp({ id: 'su1', title: 'Intro' });
    await createSubUnit(http, await ready(), 'c1', 'cu1', { title: 'Intro' });
    expect(request.mock.calls[0]![0].body).toEqual({ title: 'Intro' });
  });

  it('listSubUnits tolerates a bare array payload', async () => {
    const { http } = spyHttp([{ id: 'su1', title: 'Intro' }]);
    await expect(listSubUnits(http, await ready(), 'c1', 'cu1'))
      .resolves.toEqual([{ id: 'su1', title: 'Intro' }]);
  });

  it('listSubUnits tolerates a keyed payload', async () => {
    const { http } = spyHttp({ subContentUnits: [{ id: 'su1', title: 'Intro' }] });
    await expect(listSubUnits(http, await ready(), 'c1', 'cu1'))
      .resolves.toEqual([{ id: 'su1', title: 'Intro' }]);
  });

  it('listSubUnits returns [] for an unrecognised payload rather than throwing', async () => {
    const { http } = spyHttp({ nope: 1 });
    await expect(listSubUnits(http, await ready(), 'c1', 'cu1')).resolves.toEqual([]);
  });

  it('assignSkill posts both ids to the skills route', async () => {
    const { http, request } = spyHttp({});
    await assignSkill(http, await ready(), 'c1', 'cu1', 'su1', {
      coreCompetencyModelId: 'ccm1', levelId: 'lvl1',
    });
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: 'business/courses/c1/content-units/cu1/sub-content-units/su1/skills',
      token: 'biz',
      body: { coreCompetencyModelId: 'ccm1', levelId: 'lvl1' },
    });
  });

  it('generateArtifact posts to the generate route with an empty body by default', async () => {
    const { http, request } = spyHttp({});
    await generateArtifact(http, await ready(), 'c1', 'cu1', 'su1');
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: 'business/courses/c1/content-units/cu1/sub-content-units/su1/artifact/generate',
      token: 'biz',
      body: {},
    });
  });

  it('generateArtifact passes an instruction when given', async () => {
    const { http, request } = spyHttp({});
    await generateArtifact(http, await ready(), 'c1', 'cu1', 'su1', {
      instruction: 'keep it practical',
    });
    expect(request.mock.calls[0]![0].body).toEqual({ instruction: 'keep it practical' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd plugins/tangible-pbl && npx vitest run test/subunits.test.ts`
Expected: FAIL — cannot resolve `../src/api/subunits.js`.

- [ ] **Step 3: Write the module**

Create `plugins/tangible-pbl/src/api/subunits.ts`:

```ts
import type { AuthManager } from '../auth.js';
import type { HttpClient } from '../http.js';
import { call } from './call.js';

export interface SubContentUnit {
  id: string;
  title: string;
  description?: string | null;
  estimatedDuration?: number | null;
  sortOrder?: number;
}

export interface SubUnitSkill {
  coreCompetencyModelId: string;
  levelId?: string;
  name?: string;
}

const subUnits = (courseId: string, contentUnitId: string) =>
  `business/courses/${courseId}/content-units/${contentUnitId}/sub-content-units`;

/** Mirrors builder.ts's asArray — the API returns either a bare array or a keyed object. */
const asArray = <T>(payload: unknown, key: string): T[] => {
  if (Array.isArray(payload)) return payload as T[];
  const v = (payload as Record<string, unknown> | undefined)?.[key];
  return Array.isArray(v) ? (v as T[]) : [];
};

/**
 * Sub-content units have no generate endpoint — unlike skills, problems and
 * content units, they are authored. `estimatedDuration` is in MINUTES; the
 * backend caps it at 60000 and requires a positive integer.
 */
export const createSubUnit = (
  http: HttpClient, auth: AuthManager,
  courseId: string, contentUnitId: string,
  values: { title: string; description?: string; estimatedDuration?: number },
) =>
  call<SubContentUnit>(http, auth, {
    method: 'POST',
    path: subUnits(courseId, contentUnitId),
    // Send only what was given — the backend distinguishes absent from null.
    body: {
      title: values.title,
      ...(values.description !== undefined ? { description: values.description } : {}),
      ...(values.estimatedDuration !== undefined
        ? { estimatedDuration: values.estimatedDuration }
        : {}),
    },
  });

export const listSubUnits = async (
  http: HttpClient, auth: AuthManager, courseId: string, contentUnitId: string,
): Promise<SubContentUnit[]> =>
  asArray<SubContentUnit>(
    await call<unknown>(http, auth, {
      method: 'GET', path: subUnits(courseId, contentUnitId),
    }),
    'subContentUnits',
  );

/** Both ids are required by the backend; ten skills maximum per sub-unit. */
export const assignSkill = (
  http: HttpClient, auth: AuthManager,
  courseId: string, contentUnitId: string, subUnitId: string,
  body: { coreCompetencyModelId: string; levelId: string },
) =>
  call<unknown>(http, auth, {
    method: 'POST',
    path: `${subUnits(courseId, contentUnitId)}/${subUnitId}/skills`,
    body,
  });

/** 409 when an artifact already exists — the caller treats that as satisfied. */
export const generateArtifact = (
  http: HttpClient, auth: AuthManager,
  courseId: string, contentUnitId: string, subUnitId: string,
  body: { instruction?: string } = {},
) =>
  call<unknown>(http, auth, {
    method: 'POST',
    path: `${subUnits(courseId, contentUnitId)}/${subUnitId}/artifact/generate`,
    body,
  });
```

- [ ] **Step 4: Run to verify pass**

Run: `cd plugins/tangible-pbl && npx vitest run test/subunits.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Breakage-verify each test**

For each of the 8 tests, mutate the specific code it covers, run the file, confirm that test fails, restore. Suggested mutations:
- Path tests: drop `/sub-content-units` from the `subUnits` helper.
- "omits absent optional fields": send `description: values.description` unconditionally.
- `listSubUnits` keyed test: change the key to `'items'`.
- `listSubUnits` `[]` test: return `payload as T[]` unconditionally.
- `assignSkill`: swap the two id fields.
- `generateArtifact` default body: change `= {}` to `= { instruction: '' }`.

Record per test: the mutation, the command, the observed failure. If any mutation does not break its test, say so and name the assertion that needs strengthening.

- [ ] **Step 6: Typecheck, build, commit**

```bash
cd plugins/tangible-pbl && npx tsc --noEmit && npm run build && cd ../..
git add plugins/tangible-pbl/src/api/subunits.ts plugins/tangible-pbl/test/subunits.test.ts plugins/tangible-pbl/dist
git commit -m "feat(tangible-pbl): add the sub-content-unit, skill and artifact API"
```

---

### Task 2: Pure validation and name resolution

This is where "validate before any write" lives. It is pure, so every rule is testable without HTTP.

**Files:**
- Create: `plugins/tangible-pbl/src/session/by-name.ts`
- Create: `plugins/tangible-pbl/src/session/detail-plan.ts`
- Create: `plugins/tangible-pbl/test/detail-plan.test.ts`
- Modify: `plugins/tangible-pbl/src/session/machine.ts` (move `byName` out, import it back)

**Interfaces:**
- Consumes: `ContentUnit`, `CourseSkill` from `../api/builder.js`.
- Produces:
  - `by-name.ts`: `byName<T extends { id: string }>(items: T[], label: (t: T) => string, needle: string, what: string): T`
  - `detail-plan.ts`:
    - `interface SubUnitSpec { contentUnit: string; title: string; description?: string; minutes?: number; skills: string[] }`
    - `interface ResolvedSkill { coreCompetencyModelId: string; levelId: string; name: string }`
    - `interface ResolvedSubUnit { contentUnitId: string; contentUnitTitle: string; title: string; description?: string; estimatedDuration?: number; skills: ResolvedSkill[] }`
    - `planSubUnits(specs: SubUnitSpec[], units: ContentUnit[], courseSkills: CourseSkill[]): ResolvedSubUnit[]` — throws on any violation, resolves nothing partially.

- [ ] **Step 1: Move `byName` into its own module**

`byName` currently lives as a module-private `const` in `src/session/machine.ts`. `detail-plan.ts` needs the same exact→prefix→ambiguity behaviour, and `CLAUDE.md` already records `byName` and `resolveBusiness` as drifted duplicates — do not create a third.

Create `plugins/tangible-pbl/src/session/by-name.ts` and move the function verbatim, adding `export`:

```ts
/**
 * Exact match, then unique prefix, then an ambiguity error naming the
 * candidates. Shared by the machine's problem selection and the detail gate's
 * content-unit and skill resolution, so those three cannot drift apart.
 */
export const byName = <T extends { id: string }>(
  items: T[], label: (t: T) => string, needle: string, what: string,
): T => {
  const n = needle.trim().toLowerCase();
  const isMatch = (i: T) => label(i).toLowerCase() === n || i.id.toLowerCase() === n;
  const isPrefix = (i: T) =>
    label(i).toLowerCase().startsWith(n) || i.id.toLowerCase().startsWith(n);
  const exact = items.filter(isMatch);
  if (exact.length === 1) return exact[0]!;
  const pre = items.filter(isPrefix);
  if (pre.length === 1) return pre[0]!;
  const all = items.map(label).join(', ');
  if (pre.length > 1) {
    throw new Error(`"${needle}" matches more than one ${what}: ${pre.map(label).join(', ')}`);
  }
  throw new Error(`No ${what} matching "${needle}". Available: ${all}`);
};
```

Delete the `const byName = …` block from `machine.ts` and add at the top:

```ts
import { byName } from './by-name.js';
```

Run: `cd plugins/tangible-pbl && npx vitest run test/machine.test.ts`
Expected: PASS — the move is behaviour-preserving, and the existing problem-selection tests prove it.

- [ ] **Step 2: Write the failing tests**

Create `plugins/tangible-pbl/test/detail-plan.test.ts`:

```ts
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
    expect(bare!.estimatedDuration).toBeUndefined();
    expect(bare!.description).toBeUndefined();
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

  it('rejects a skill with no Level, naming it — levelId is required to assign', () => {
    const noLevel = [skill('Visual Hierarchy', { Level: undefined })];
    expect(() => planSubUnits([spec()], units, noLevel))
      .toThrow(/Visual Hierarchy.*no level/s);
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
```

- [ ] **Step 3: Run to verify failure**

Run: `cd plugins/tangible-pbl && npx vitest run test/detail-plan.test.ts`
Expected: FAIL — cannot resolve `../src/session/detail-plan.js`.

- [ ] **Step 4: Write the module**

Create `plugins/tangible-pbl/src/session/detail-plan.ts`:

```ts
import type { ContentUnit, CourseSkill } from '../api/builder.js';
import { byName } from './by-name.js';

/** What the caller supplies for one sub-content unit. `minutes` is minutes. */
export interface SubUnitSpec {
  contentUnit: string;
  title: string;
  description?: string;
  minutes?: number;
  skills: string[];
}

export interface ResolvedSkill {
  coreCompetencyModelId: string;
  levelId: string;
  name: string;
}

export interface ResolvedSubUnit {
  contentUnitId: string;
  contentUnitTitle: string;
  title: string;
  description?: string;
  estimatedDuration?: number;
  skills: ResolvedSkill[];
}

/** Server-enforced by subContentUnitSkillUnderLimit. */
const MAX_SKILLS = 10;
/** Server-enforced ceiling on estimatedDuration, in minutes. */
const MAX_MINUTES = 60000;

/**
 * Resolves a caller-supplied breakdown against the live course, or throws.
 *
 * Pure and total: it either returns a fully resolved plan or throws having
 * written nothing. The detail gate depends on that — a partial resolution
 * would leave sub-units created for the valid half of a breakdown and nothing
 * for the rest, with no way to tell which.
 *
 * Every message names the offender by name. No id appears in any error: the
 * caller addresses everything by name and has no use for one.
 */
export const planSubUnits = (
  specs: SubUnitSpec[],
  units: ContentUnit[],
  courseSkills: CourseSkill[],
): ResolvedSubUnit[] => {
  if (specs.length === 0) {
    throw new Error('Pass at least one sub-content unit to create.');
  }

  const selected = courseSkills.filter((s) => s.isSelected);

  return specs.map((s) => {
    const title = s.title?.trim() ?? '';
    if (title.length === 0) {
      throw new Error(`Every sub-content unit needs a title (under "${s.contentUnit}").`);
    }

    const unit = byName(units, (u) => u.title, s.contentUnit, 'content unit');

    if (s.skills.length === 0) {
      throw new Error(
        `"${title}" has no skills. Every sub-content unit needs at least one skill — ` +
          `publishing refuses a course whose sub-units have none.`,
      );
    }
    if (s.skills.length > MAX_SKILLS) {
      throw new Error(
        `"${title}" has ${s.skills.length} skills. Tangible allows at most ten skills ` +
          `per sub-content unit.`,
      );
    }

    if (s.minutes !== undefined) {
      if (!Number.isInteger(s.minutes) || s.minutes <= 0) {
        throw new Error(
          `"${title}" has minutes=${s.minutes}. Give a positive whole number of minutes.`,
        );
      }
      if (s.minutes > MAX_MINUTES) {
        throw new Error(`"${title}" has minutes=${s.minutes}, above the maximum of 60000.`);
      }
    }

    const skills = s.skills.map((name) => {
      const match = byName(selected, (k) => k.CoreCompetencyModel.name, name, 'skill');
      if (!match.Level?.id) {
        throw new Error(
          `Skill "${match.CoreCompetencyModel.name}" has no level, and assigning a skill ` +
            `to a sub-content unit requires one. Choose a different skill for "${title}".`,
        );
      }
      return {
        coreCompetencyModelId: match.CoreCompetencyModel.id,
        levelId: match.Level.id,
        name: match.CoreCompetencyModel.name,
      };
    });

    return {
      contentUnitId: unit.id,
      contentUnitTitle: unit.title,
      title,
      ...(s.description !== undefined ? { description: s.description } : {}),
      ...(s.minutes !== undefined ? { estimatedDuration: s.minutes } : {}),
      skills,
    };
  });
};
```

- [ ] **Step 5: Run to verify pass**

Run: `cd plugins/tangible-pbl && npx vitest run test/detail-plan.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 6: Breakage-verify, with attention to the boundary and the negative**

Mutate each covered rule and confirm its test fails; restore each time. Specifically:
- Change `> MAX_SKILLS` to `>= MAX_SKILLS` — the "accepts exactly ten" test must fail. This is the boundary pair; a pair using 5 and 11 would pass under both operators, which is the exact off-by-one shape that shipped here before.
- Delete the `!match.Level?.id` guard — the no-level test must fail.
- Drop `.filter((s) => s.isSelected)` — the "only considers selected skills" test must fail.
- Interpolate `unit.id` into the unknown-content-unit message — the no-id test must fail. If it does not, the fixture never reaches a path that could emit an id, and the assertion is worthless; say so.

- [ ] **Step 7: Typecheck, build, commit**

```bash
cd plugins/tangible-pbl && npx tsc --noEmit && npm test && npm run build && cd ../..
git add plugins/tangible-pbl/src/session plugins/tangible-pbl/test/detail-plan.test.ts plugins/tangible-pbl/dist
git commit -m "feat(tangible-pbl): validate and resolve a sub-unit breakdown before any write"
```

---

### Task 3: The `detail` gate

**Files:**
- Modify: `plugins/tangible-pbl/src/session/machine.ts`
- Modify: `plugins/tangible-pbl/test/machine.test.ts`

**Interfaces:**
- Consumes: `ResolvedSubUnit`, `planSubUnits` from `./detail-plan.js`; `SubContentUnit` from `../api/subunits.js`.
- Produces:
  - `STEP_ORDER` = `['context','skills','problems','outline','detail','artifacts','publish','invite','done']`
  - `Produced` gains `{ kind: 'detail'; created: { contentUnitTitle: string; title: string; skills: string[] }[] }`
  - `ApproveInput` gains `subUnits?: SubUnitSpec[]`
  - `MachineDeps` gains:
    - `listContentUnits(courseId: string): Promise<ContentUnit[]>`
    - `createSubUnit(courseId, contentUnitId, values): Promise<SubContentUnit>`
    - `assignSkill(courseId, contentUnitId, subUnitId, body): Promise<unknown>`

- [ ] **Step 1: Write the failing tests**

Append to `plugins/tangible-pbl/test/machine.test.ts` (match the file's existing deps-fixture style):

```ts
describe('advance to detail', () => {
  const units = [{ id: 'cu1', title: 'Module One' }];
  const skills = [{
    id: 'cs1', isSelected: true,
    CoreCompetencyModel: { id: 'ccm1', name: 'Visual Hierarchy' },
    Level: { id: 'lvl1', name: 'Foundational' },
  }];

  const detailDeps = (over: Partial<MachineDeps> = {}): MachineDeps => ({
    ...baseDeps(),
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
    const deps = detailDeps();
    const { state, produced } = await advance(deps, memory({ step: 'outline' }), input);
    expect(state.step).toBe('detail');
    expect(deps.createSubUnit).toHaveBeenCalledWith('c1', 'cu1', {
      title: 'Lesson A', estimatedDuration: 45,
    });
    expect(deps.assignSkill).toHaveBeenCalledWith('c1', 'cu1', 'su-Lesson A', {
      coreCompetencyModelId: 'ccm1', levelId: 'lvl1',
    });
    expect(produced).toEqual({
      kind: 'detail',
      created: [{ contentUnitTitle: 'Module One', title: 'Lesson A', skills: ['Visual Hierarchy'] }],
    });
  });

  it('refuses to advance without a breakdown', async () => {
    await expect(advance(detailDeps(), memory({ step: 'outline' }), {}))
      .rejects.toThrow(/subUnits/);
  });

  it('writes nothing when validation fails', async () => {
    const deps = detailDeps();
    await expect(
      advance(deps, memory({ step: 'outline' }), {
        subUnits: [{ contentUnit: 'Nope', title: 'A', skills: ['Visual Hierarchy'] }],
      }),
    ).rejects.toThrow(/No content unit matching/);
    // The whole point of validating first: a bad name in the breakdown must not
    // leave half of it created.
    expect(deps.createSubUnit).not.toHaveBeenCalled();
    expect(deps.assignSkill).not.toHaveBeenCalled();
  });

  it('validates every entry before creating any of them', async () => {
    const deps = detailDeps();
    await expect(
      advance(deps, memory({ step: 'outline' }), {
        subUnits: [
          { contentUnit: 'Module One', title: 'Good', skills: ['Visual Hierarchy'] },
          { contentUnit: 'Module One', title: 'Bad', skills: ['Unknown'] },
        ],
      }),
    ).rejects.toThrow(/No skill matching "Unknown"/);
    expect(deps.createSubUnit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd plugins/tangible-pbl && npx vitest run test/machine.test.ts`
Expected: FAIL — `createSubUnit` is not on `MachineDeps`, and `advance` has no `detail` creation logic.

- [ ] **Step 3: Extend `STEP_ORDER`, `Produced`, `ApproveInput` and `MachineDeps`**

In `src/session/machine.ts`:

```ts
export const STEP_ORDER: Step[] = [
  'context', 'skills', 'problems', 'outline', 'detail', 'artifacts',
  'publish', 'invite', 'done',
];
```

Add `'artifacts'` to the `Step` union in `src/session/memory.ts`:

```ts
export type Step =
  | 'context' | 'skills' | 'problems' | 'outline'
  | 'detail' | 'artifacts' | 'publish' | 'invite' | 'done';
```

Add to `Produced`:

```ts
  | { kind: 'detail'; created: { contentUnitTitle: string; title: string; skills: string[] }[] }
```

Add to `ApproveInput`:

```ts
  /** The sub-content-unit breakdown, required when advancing to "detail". */
  subUnits?: SubUnitSpec[];
```

Add to `MachineDeps`:

```ts
  listContentUnits(courseId: string): Promise<ContentUnit[]>;
  createSubUnit(
    courseId: string, contentUnitId: string,
    values: { title: string; description?: string; estimatedDuration?: number },
  ): Promise<SubContentUnit>;
  assignSkill(
    courseId: string, contentUnitId: string, subUnitId: string,
    body: { coreCompetencyModelId: string; levelId: string },
  ): Promise<unknown>;
```

Add the imports:

```ts
import { planSubUnits, type SubUnitSpec } from './detail-plan.js';
import type { SubContentUnit } from '../api/subunits.js';
```

- [ ] **Step 4: Replace the `detail` case**

Replace the existing no-op:

```ts
    case 'detail': {
      if (!input.subUnits?.length) {
        throw new Error(
          'Pass subUnits to build the detail layer — each needs a contentUnit name, a ' +
            'title, and at least one skill name. Nothing is created until this call.',
        );
      }
      // Resolve and validate the whole breakdown first. planSubUnits throws
      // rather than resolving partially, so a bad name cannot leave half the
      // sub-units created with no way to tell which.
      const [units, course] = await Promise.all([
        deps.listContentUnits(state.courseId),
        deps.getCourse(state.courseId),
      ]);
      const plan = planSubUnits(input.subUnits, units, course.CourseSkills ?? []);

      const created: { contentUnitTitle: string; title: string; skills: string[] }[] = [];
      for (const r of plan) {
        deps.onProgress?.(`Creating "${r.title}"…`);
        const su = await deps.createSubUnit(state.courseId, r.contentUnitId, {
          title: r.title,
          ...(r.description !== undefined ? { description: r.description } : {}),
          ...(r.estimatedDuration !== undefined
            ? { estimatedDuration: r.estimatedDuration }
            : {}),
        });
        for (const skill of r.skills) {
          await deps.assignSkill(state.courseId, r.contentUnitId, su.id, {
            coreCompetencyModelId: skill.coreCompetencyModelId,
            levelId: skill.levelId,
          });
        }
        created.push({
          contentUnitTitle: r.contentUnitTitle,
          title: r.title,
          skills: r.skills.map((s) => s.name),
        });
      }
      return done({ kind: 'detail', created });
    }
```

- [ ] **Step 5: Run to verify pass**

Run: `cd plugins/tangible-pbl && npx vitest run test/machine.test.ts`
Expected: PASS. Other suites will not compile yet — `ledger.ts` does not handle `kind: 'detail'` and the tools layer does not supply the new deps. Task 4 and Task 5 close that.

- [ ] **Step 6: Breakage-verify**

- Move the `planSubUnits` call to after the creation loop — the "writes nothing when validation fails" and "validates every entry" tests must both fail. This proves those tests actually pin the validate-first ordering rather than passing because the fixture happens not to reach creation.
- Change `if (!input.subUnits?.length)` to `if (!input.subUnits)` — the refuses-without-a-breakdown test must still pass, but add `subUnits: []` to that test if it does not, so the empty-array case is genuinely covered.

- [ ] **Step 7: Commit**

```bash
cd plugins/tangible-pbl && npx tsc --noEmit 2>&1 | head -20; cd ../..
git add plugins/tangible-pbl/src/session plugins/tangible-pbl/test/machine.test.ts
git commit -m "feat(tangible-pbl): create sub-content units and assign skills at the detail gate"
```

`dist/` is deliberately omitted here — the build cannot succeed until Task 5 updates the tools layer. Task 5 restores it before anything is pushed. Do not stub or `@ts-ignore` anything to force a green build.

---

### Task 4: The `artifacts` gate

**Files:**
- Modify: `plugins/tangible-pbl/src/session/machine.ts`
- Modify: `plugins/tangible-pbl/test/machine.test.ts`

**Interfaces:**
- Consumes: everything from Task 3.
- Produces:
  - `Produced` gains `{ kind: 'artifacts'; generated: string[]; failed: { title: string; reason: string }[] }`
  - `ApproveInput` gains `instruction?: string`
  - `MachineDeps` gains:
    - `listSubUnits(courseId: string, contentUnitId: string): Promise<SubContentUnit[]>`
    - `generateArtifact(courseId, contentUnitId, subUnitId, body: { instruction?: string }): Promise<unknown>`

- [ ] **Step 1: Write the failing tests**

Append to `plugins/tangible-pbl/test/machine.test.ts`:

```ts
describe('advance to artifacts', () => {
  const units = [{ id: 'cu1', title: 'Module One' }];
  const subs = [{ id: 'su1', title: 'Lesson A' }, { id: 'su2', title: 'Lesson B' }];

  const artifactDeps = (over: Partial<MachineDeps> = {}): MachineDeps => ({
    ...baseDeps(),
    listContentUnits: vi.fn().mockResolvedValue(units),
    listSubUnits: vi.fn().mockResolvedValue(subs),
    generateArtifact: vi.fn().mockResolvedValue({}),
    ...over,
  });

  it('generates one artifact per sub-unit', async () => {
    const deps = artifactDeps();
    const { state, produced } = await advance(deps, memory({ step: 'detail' }), {});
    expect(state.step).toBe('artifacts');
    expect(deps.generateArtifact).toHaveBeenCalledTimes(2);
    expect(produced).toEqual({ kind: 'artifacts', generated: ['Lesson A', 'Lesson B'], failed: [] });
  });

  it('passes the instruction to every call', async () => {
    const deps = artifactDeps();
    await advance(deps, memory({ step: 'detail' }), { instruction: 'keep it practical' });
    for (const call of (deps.generateArtifact as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[3]).toEqual({ instruction: 'keep it practical' });
    }
  });

  it('counts a 409 as already satisfied, not a failure', async () => {
    const conflict = Object.assign(new Error('artifact exists'), { status: 409 });
    const deps = artifactDeps({
      generateArtifact: vi.fn()
        .mockRejectedValueOnce(conflict)
        .mockResolvedValueOnce({}),
    });
    const { produced } = await advance(deps, memory({ step: 'detail' }), {});
    expect(produced).toEqual({ kind: 'artifacts', generated: ['Lesson A', 'Lesson B'], failed: [] });
  });

  it('continues past a failure and reports both lists', async () => {
    const deps = artifactDeps({
      generateArtifact: vi.fn()
        .mockRejectedValueOnce(new Error('upstream exploded'))
        .mockResolvedValueOnce({}),
    });
    const { produced } = await advance(deps, memory({ step: 'detail' }), {});
    // Aborting on the first failure would discard the second generation and
    // leave no way to resume mid-gate.
    expect(deps.generateArtifact).toHaveBeenCalledTimes(2);
    expect(produced).toEqual({
      kind: 'artifacts',
      generated: ['Lesson B'],
      failed: [{ title: 'Lesson A', reason: 'upstream exploded' }],
    });
  });

  it('advances even when every artifact fails, so the gate is not a dead end', async () => {
    const deps = artifactDeps({
      generateArtifact: vi.fn().mockRejectedValue(new Error('nope')),
    });
    const { state, produced } = await advance(deps, memory({ step: 'detail' }), {});
    expect(state.step).toBe('artifacts');
    expect((produced as { generated: string[] }).generated).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd plugins/tangible-pbl && npx vitest run test/machine.test.ts -t artifacts`
Expected: FAIL — `listSubUnits` is not on `MachineDeps`.

- [ ] **Step 3: Extend the types**

Add to `Produced`:

```ts
  | { kind: 'artifacts'; generated: string[]; failed: { title: string; reason: string }[] }
```

Add to `ApproveInput`:

```ts
  /** Optional steer applied to every artifact generated at the "artifacts" gate. */
  instruction?: string;
```

Add to `MachineDeps`:

```ts
  listSubUnits(courseId: string, contentUnitId: string): Promise<SubContentUnit[]>;
  generateArtifact(
    courseId: string, contentUnitId: string, subUnitId: string,
    body: { instruction?: string },
  ): Promise<unknown>;
```

- [ ] **Step 4: Add the `artifacts` case**

Insert after the `detail` case:

```ts
    case 'artifacts': {
      const units = await deps.listContentUnits(state.courseId);
      const generated: string[] = [];
      const failed: { title: string; reason: string }[] = [];

      for (const unit of units) {
        for (const sub of await deps.listSubUnits(state.courseId, unit.id)) {
          deps.onProgress?.(`Generating the artifact for "${sub.title}"…`);
          try {
            await deps.generateArtifact(state.courseId, unit.id, sub.id, {
              ...(input.instruction !== undefined ? { instruction: input.instruction } : {}),
            });
            generated.push(sub.title);
          } catch (err) {
            // 409 means an artifact already exists, which satisfies the goal of
            // "every sub-unit has one" — regenerating is a separate decision.
            if ((err as { status?: number }).status === 409) {
              generated.push(sub.title);
              continue;
            }
            // Carry on: aborting here would discard every generation that
            // already succeeded, and there is no way to resume mid-gate.
            failed.push({
              title: sub.title,
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
      return done({ kind: 'artifacts', generated, failed });
    }
```

- [ ] **Step 5: Run to verify pass**

Run: `cd plugins/tangible-pbl && npx vitest run test/machine.test.ts`
Expected: PASS.

- [ ] **Step 6: Breakage-verify**

- Delete the `status === 409` branch — the 409 test must fail.
- Replace the `catch` body with `throw err` — the continues-past-a-failure test must fail *and* the call count assertion must drop to 1, proving the test pins continuation rather than just the shape of `produced`.
- Change `generated.push(sub.title)` in the 409 branch to `failed.push(...)` — the 409 test must fail on the `failed` array being non-empty.

- [ ] **Step 7: Commit**

```bash
cd plugins/tangible-pbl && npx tsc --noEmit 2>&1 | head -20; cd ../..
git add plugins/tangible-pbl/src/session plugins/tangible-pbl/test/machine.test.ts
git commit -m "feat(tangible-pbl): generate artifacts at their own gate"
```

`dist/` again omitted — Task 5 restores it.

---

### Task 5: Ledger rendering and the tools layer

This is the task that makes the build green again.

**Files:**
- Modify: `plugins/tangible-pbl/src/session/ledger.ts`
- Modify: `plugins/tangible-pbl/src/tools/session.ts`
- Modify: `plugins/tangible-pbl/test/tools.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: `pbl_approve` accepting `subUnits` and `instruction`; `depsFor` supplying the four new `MachineDeps` calls; `pbl_status` listing sub-units.

- [ ] **Step 1: Render the new `Produced` kinds**

In `src/session/ledger.ts`, add to `renderProduced`'s switch, before `case 'none'`:

```ts
    case 'detail':
      return produced.created.length === 0
        ? 'No sub-content units were created.'
        : ['Sub-content units:', ...produced.created.map(
            (c) => `  ${c.contentUnitTitle} › ${c.title} [${c.skills.join(', ')}]`,
          )].join('\n');
    case 'artifacts': {
      const lines = [`Artifacts: ${produced.generated.length} generated.`];
      if (produced.failed.length > 0) {
        lines.push(
          `${produced.failed.length} failed:`,
          ...produced.failed.map((f) => `  ${f.title} — ${f.reason}`),
        );
      }
      return lines.join('\n');
    }
```

`renderProduced` has no `default`, so `strict` mode makes a missing case a compile error — that is the property that keeps this in step with `Produced`.

- [ ] **Step 2: Supply the new deps**

In `src/tools/session.ts`, add the imports:

```ts
import {
  createSubUnit, listSubUnits, assignSkill, generateArtifact,
} from '../api/subunits.js';
```

`listContentUnits` is already imported from `../api/builder.js`.

Extend `depsFor`:

```ts
  listContentUnits: (id: string) => listContentUnits(rt.http, rt.auth, id),
  createSubUnit: (id: string, cuId: string, values: Parameters<typeof createSubUnit>[4]) =>
    createSubUnit(rt.http, rt.auth, id, cuId, values),
  assignSkill: (id: string, cuId: string, suId: string, body: { coreCompetencyModelId: string; levelId: string }) =>
    assignSkill(rt.http, rt.auth, id, cuId, suId, body),
  listSubUnits: (id: string, cuId: string) => listSubUnits(rt.http, rt.auth, id, cuId),
  generateArtifact: (id: string, cuId: string, suId: string, body: { instruction?: string }) =>
    generateArtifact(rt.http, rt.auth, id, cuId, suId, body),
```

- [ ] **Step 3: Accept the new inputs on `pbl_approve`**

Add to `pbl_approve`'s zod schema:

```ts
      subUnits: z
        .array(
          z.object({
            contentUnit: z.string().describe('Name of the content unit this sits under'),
            title: z.string(),
            description: z.string().optional(),
            minutes: z.number().int().positive().max(60000).optional()
              .describe('Estimated duration in MINUTES'),
            skills: z.array(z.string()).min(1).max(10)
              .describe('Skill names, resolved against the course’s selected skills'),
          }),
        )
        .optional()
        .describe(
          'The sub-content-unit breakdown. Required when advancing to "detail". ' +
            'Nothing is created until this call — draft it, get agreement, then send it.',
        ),
      instruction: z.string().optional()
        .describe('Optional steer applied to every artifact at the "artifacts" gate'),
```

Destructure them into `input` — they already flow through the existing `...input` spread into `advance`.

- [ ] **Step 4: List sub-units in `pbl_status`**

In the single-session branch of `pbl_status`, after loading `state`, append a sub-unit listing when the course has reached `detail`:

```ts
      const detailReached =
        STEP_ORDER.indexOf(state.step) >= STEP_ORDER.indexOf('detail');
      let breakdown = '';
      if (detailReached) {
        const units = await listContentUnits(current.http, current.auth, state.courseId);
        const lines: string[] = [];
        for (const u of units) {
          lines.push(u.title);
          for (const s of await listSubUnits(current.http, current.auth, state.courseId, u.id)) {
            lines.push(`  ${s.title}`);
          }
        }
        // Names only — pbl_add_resource takes these, so this listing is what
        // makes that tool reachable at all.
        if (lines.length > 0) breakdown = `\n\nBreakdown:\n${lines.join('\n')}`;
      }
```

and append `breakdown` to the returned text. Import `STEP_ORDER` from `../session/machine.js`.

- [ ] **Step 5: Write the tests**

Append to `plugins/tangible-pbl/test/tools.test.ts`, matching the file's existing `makeRuntime`/`captureHandlers` style:

```ts
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
          Level: { id: 'lvl1', name: 'Foundational' },
        }],
      }],
      [/content-units$/, [{ id: 'cu1', title: 'Module One' }]],
      [/sub-content-units$/, { id: 'su1', title: 'Lesson A' }],
    ]);
    const rtHolder = { current: await makeRuntime(http, root) };
    await seed(rtHolder.current.store, 'outline');
    const handlers = captureHandlers(registerSessionTools, rtHolder);

    const result = await handlers.get('pbl_approve')!({
      sessionId: 's1',
      subUnits: [{
        contentUnit: 'Module One', title: 'Lesson A', minutes: 45,
        skills: ['Visual Hierarchy'],
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
```

Add `RequestOpts` to the type import from `../src/http.js` if it is not already there. Order matters in the answer lists — the first matching pattern wins, so the more specific path must come first.

- [ ] **Step 6: Full green**

Run: `cd plugins/tangible-pbl && npx tsc --noEmit && npm test && npm run build`
Expected: typecheck clean, all tests pass, build succeeds.

Run from the repo root: `git diff --exit-code -- plugins/tangible-pbl/dist; echo "dist=$?"`
Expected: `dist=0` after the build — `dist/` now matches the source again for the first time since Task 2.

- [ ] **Step 7: Verify the tool surface**

Boot the built server over stdio with staging env vars and send `initialize` then `tools/list`. It must report `pbl-mcp` and **14** tools — this task adds no new tools, it extends existing ones. If the count changed, find out why.

- [ ] **Step 8: Commit**

```bash
cd plugins/tangible-pbl && npm run build && cd ../..
git add plugins/tangible-pbl/src plugins/tangible-pbl/test plugins/tangible-pbl/dist
git commit -m "feat(tangible-pbl): drive the detail and artifacts gates from the tools layer"
```

---

### Task 6: Make `pbl_add_resource` reachable and guard `pbl_publish`

**Files:**
- Modify: `plugins/tangible-pbl/src/tools/direct.ts`
- Modify: `plugins/tangible-pbl/test/tools.test.ts`

**Interfaces:**
- Consumes: `listSubUnits` from `../api/subunits.js`; `listContentUnits`, `getCourse` from `../api/builder.js`; `byName` from `../session/by-name.js`.
- Produces: `pbl_add_resource` taking `contentUnit` and `subUnit` names; `pbl_publish` refusing with a named gap list.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/tangible-pbl/test/tools.test.ts`:

```ts
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
```

Add `registerDirectTools` to the imports from `../src/tools/direct.js`, and `RequestOpts` to the type import from `../src/http.js`. Order matters in `routed`'s answer list — the more specific pattern must come first, because the first match wins.

- [ ] **Step 2: Add `listSubUnitSkills` to the API module**

In `src/api/subunits.ts`:

```ts
export const listSubUnitSkills = async (
  http: HttpClient, auth: AuthManager,
  courseId: string, contentUnitId: string, subUnitId: string,
): Promise<SubUnitSkill[]> =>
  asArray<SubUnitSkill>(
    await call<unknown>(http, auth, {
      method: 'GET',
      path: `${subUnits(courseId, contentUnitId)}/${subUnitId}/skills`,
    }),
    'skills',
  );
```

- [ ] **Step 3: Rewrite `pbl_add_resource`**

Replace its schema's `contentUnitId`/`subUnitId` with `contentUnit`/`subUnit` strings, and resolve them:

```ts
    async ({ courseId, contentUnit, subUnit, ...values }) => {
      const current = rt.current;
      const units = await listContentUnits(current.http, current.auth, courseId);
      const unit = byName(units, (u) => u.title, contentUnit, 'content unit');
      const subs = await listSubUnits(current.http, current.auth, courseId, unit.id);
      const sub = byName(subs, (s) => s.title, subUnit, 'sub-content unit');
      await addResource(
        current.http, current.auth, courseId, unit.id, sub.id, values,
      );
      return text(`${banner(current)}\nAdded resource "${values.title}" to "${sub.title}".`);
    },
```

- [ ] **Step 4: Guard `pbl_publish`**

Before calling `publishCourse`:

```ts
      // Tangible refuses to publish a course whose content units lack a
      // sub-unit with a skill. Check locally and name the gaps rather than
      // surfacing the backend's bare 400 — this is the failure this plugin hit
      // on every run before the detail layer existed.
      const units = await listContentUnits(current.http, current.auth, courseId);
      const gaps: string[] = [];
      for (const unit of units) {
        const subs = await listSubUnits(current.http, current.auth, courseId, unit.id);
        if (subs.length === 0) {
          gaps.push(`"${unit.title}" has no sub-content units`);
          continue;
        }
        const withSkill: string[] = [];
        for (const sub of subs) {
          const skills = await listSubUnitSkills(
            current.http, current.auth, courseId, unit.id, sub.id,
          );
          if (skills.length > 0) withSkill.push(sub.title);
        }
        if (withSkill.length === 0) {
          gaps.push(`"${unit.title}" has no sub-content unit with a skill`);
        }
      }
      if (gaps.length > 0) {
        throw new Error(
          `Cannot publish yet:\n${gaps.map((g) => `  ${g}`).join('\n')}\n` +
            `Run pbl_approve at the detail gate to build the missing sub-content units.`,
        );
      }
```

- [ ] **Step 5: Run, breakage-verify, build**

Run: `cd plugins/tangible-pbl && npx vitest run test/tools.test.ts`
Expected: PASS.

Breakage-verify: delete the `gaps.length > 0` throw and confirm both refusal tests fail; make `byName` resolution use the raw input instead of resolving and confirm the resource tests fail. Restore each.

Run: `cd plugins/tangible-pbl && npx tsc --noEmit && npm test && npm run build`

- [ ] **Step 6: Commit**

```bash
git add plugins/tangible-pbl/src plugins/tangible-pbl/test plugins/tangible-pbl/dist
git commit -m "feat(tangible-pbl): address resources by name and guard publish on its precondition"
```

---

### Task 7: Documentation

**Files:**
- Modify: `plugins/tangible-pbl/CLAUDE.md`
- Modify: `plugins/tangible-pbl/README.md`

- [ ] **Step 1: Update `CLAUDE.md`**

1. In "Known limitations and deferred work", delete the "**Cannot publish yet**" paragraph and the "**`pbl_add_resource` is currently undrivable**" paragraph — both are now false.
2. Add to "Backend behaviour you cannot infer from the code" a new item 9 recording, in the style of its neighbours: sub-content units have **no** generate endpoint and are authored; `estimatedDuration` is in minutes, positive integer, max 60000; assigning a skill needs both `coreCompetencyModelId` and `levelId`; ten skills maximum per sub-unit; sub-unit creation requires `DRAFT`; artifact `generate` 409s when one exists and `regenerate` is the separate path; `sortOrder` is server-assigned.
3. Update the step list wherever the ledger's steps are named, to include `artifacts`.
4. Correct the test count in "Working here" to what `npm test` reports.

- [ ] **Step 2: Update `README.md`**

Document the `detail` and `artifacts` gates, the `subUnits` shape (naming minutes explicitly), the name-addressed `pbl_add_resource`, and the publish precondition. Remove any statement that the detail layer is unimplemented or that publishing cannot work.

- [ ] **Step 3: Verify the docs match reality**

Run: `cd plugins/tangible-pbl && npm test 2>&1 | tail -3`
Expected: the count printed matches what you wrote into `CLAUDE.md`.

Run: `grep -rn "Cannot publish yet\|undrivable" plugins/tangible-pbl/CLAUDE.md plugins/tangible-pbl/README.md`
Expected: no matches.

- [ ] **Step 4: Full verification**

```bash
cd plugins/tangible-pbl && npx tsc --noEmit && npm test && npm run build && cd ../..
git diff --exit-code -- plugins/tangible-pbl/dist && echo "dist-clean=OK"
node scripts/validate.mjs
```

- [ ] **Step 5: Commit**

```bash
git add plugins/tangible-pbl/CLAUDE.md plugins/tangible-pbl/README.md
git commit -m "docs(tangible-pbl): document the detail and artifacts gates"
```

- [ ] **Step 6: Do not bump any version**

`release-please` owns versions and `scripts/validate.mjs` fails the build if `package.json`, `.claude-plugin/plugin.json` or the root `marketplace.json` are edited by hand.

---

## Verification against the spec

| Spec verification point | Proven by |
|---|---|
| 1. Creates sub-units under the named content unit with skills | Task 3 "creates each sub-unit and assigns its skills" |
| 2. Unknown unit / unknown skill / 11 skills / no skills fail before any write | Task 2 rejection tests + Task 3 "writes nothing when validation fails" |
| 3. Exact, then unique prefix, then ambiguity | Task 2 prefix test; `byName` shared via `by-name.ts` |
| 4. A skill with no `Level` is reported by name before any write | Task 2 "rejects a skill with no Level" |
| 5. One artifact per sub-unit; 409 counts as success; one failure does not stop the rest | Task 4 four artifact tests |
| 6. `pbl_status` lists sub-units; `pbl_add_resource` accepts those names | Task 5 Step 4; Task 6 resource tests |
| 7. `pbl_publish` refuses naming the gaps | Task 6 publish tests |
| 8. No UUID in any new output | Task 2 "never puts an id in a validation error"; Task 6 sub-unit mismatch test |
| 9. `advance()` keeps two call sites and one step per invocation | Existing `test/machine.test.ts`, unchanged and still green |
| 10. Each new test breakage-verified | Steps 5/6 of Tasks 1–4, Step 5 of Task 6 |
