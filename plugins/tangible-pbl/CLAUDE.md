# CLAUDE.md — tangible-pbl

Guidance for agents working on this plugin. Read this before changing anything.

## What this is

An MCP server (stdio) that authors a Problem-Based Learning course in the
Tangible product from a single brief. It drives Tangible's business REST API
directly and stops at **eight human approval gates**. The Tangible web app is
used only as a **viewer** — every gate returns a URL, never a browser action.

Built in `tangible-internal-tools` across ten reviewed increments, then moved
here for distribution. That repo still holds the design spec and plan:
`docs/superpowers/specs/2026-08-03-pbl-mcp-design.md` and
`docs/superpowers/plans/2026-08-03-pbl-mcp.md`.

## Non-negotiables

**Nothing advances without an explicit human call.** `advance()` must have
exactly two call sites — `pbl_approve` and `pbl_revise` — and must move exactly
one step per invocation. No auto-chaining, no recursion, no timers. This is the
product's entire premise; `test/machine.test.ts` enforces it. If a change makes
`advance()` reachable from anywhere else, the change is wrong.

**No UUID is ever surfaced in output.** Names in, names out. The one accepted
exception is `courseId` inside the review URL, where it is a routing path
segment. This applies to error messages too, not just rendered gate output.

**Environment isolation is layered, and all layers matter.** Course memory
files are namespaced `courses/<env>/`; `assertSafeId` (`/^[A-Za-z0-9_-]+$/`)
blocks path traversal through a caller-supplied `sessionId`; the zod enum on
`pbl_use_environment` is the *only* runtime validation of `env`; every tool
handler snapshots `const current = rt.current` at entry so a mid-flight
environment switch cannot mix old and new. Do not remove any of these
individually — each covers a different attack.

**Course memory is append-only.** `CourseMemoryStore.save` rewrites the
frontmatter and inserts at most one log entry; every other byte of the body —
including hand-written `## Notes` and every earlier entry — passes through
verbatim. A revise appends a second entry rather than editing the first. Tests
in `test/memory.test.ts` pin this. There is no `delete`: `pbl_abort` sets
`status: closed`, and removing a record is the user's to do with `rm`.

**`pbl_publish` and `pbl_invite` write no log entry, by design.** Both live in
`src/tools/direct.ts` and take a raw `courseId` rather than a course slug, and
there is no reverse `courseId` → slug lookup to find the memory file that may
well already exist for that course. This is a decided boundary, not an
oversight: those two are escape hatches for operating on any course, session
or not, and `reconcile()` catches an out-of-band publish the next time
someone runs `pbl_resume` against that course.

## Backend behaviour you cannot infer from the code

These were established by reading `backend/src/api-docs/**` and cost real
debugging. Do not re-derive them by guessing.

1. **`content-units/generate` flips the course `INITIALIZING → DRAFT`
   server-side.** It is not a separate call. Context, skills, and problems all
   require `INITIALIZING`, so **once the outline exists those three are frozen
   permanently.** `assertRevisable` refuses them with an explanation rather
   than letting the API 403. This makes problem selection (gate 3) the last
   point where the course's foundations can change.
2. **New contexts arrive unselected.** `POST course-contexts` creates a
   `USER_ADDED` item that is "not selected and not AI-recommended by default".
   `course-skills/generate` returns **422** without *selected* contexts — so
   every `addContext` must be followed by `selectContext`. This bug shipped
   twice before being caught; `applyContexts` is the shared helper that now
   prevents a third.
3. **`DURATION` is server-enforced single-select** (selecting one deselects the
   others in a transaction). `LEARNING_OUTCOME` and `LEARNER_PROFILE` have no
   documented exclusivity and **accumulate**.
4. **`course-problems/generate`** needs selected contexts *and* a minimum
   number of selected skills. **`content-units/generate`** needs both of those
   *and* a selected problem.
5. **`publish`** requires a `DRAFT` course with ≥1 content unit, and every
   content unit must have ≥1 sub-content unit **with a skill assigned**.
6. **`POST /business/courses`** takes exactly `{ prompt }` — the brief goes
   there verbatim.
7. Auth is two-step: `POST /auth/login` (email+password → personal JWT), then
   `POST /auth/business/login` (businessId + that Bearer → business-scoped JWT).
   Every `business/*` route needs the second token.
8. **Responses are wrapped in a `payload` envelope**, and `http.ts` unwraps it
   for every call. This assumption had never been tested against a real
   response: the first staging run created a course whose `payload` was truthy
   but carried no `id`, so every following call went to
   `business/courses/undefined/...`. `request()` now throws when a body has no
   `payload` key at all, naming the keys it did have.
   **The course object's own shape inside that envelope is still unconfirmed.**
   Rather than pin one key, `asCourse()` in `src/api/builder.ts` looks for
   `id`/`courseId`/`uuid`/`_id` on the payload and on `.course`/`.Course`/
   `.data`/`.courseData`, and every course-returning endpoint goes through it
   via `courseCall`. When none match it throws naming the keys actually
   present, nested one level — **the error is the diagnostic**, so one failed
   call identifies the shape. If you see that error, add the path it names to
   `COURSE_AT` or `ID_AT`; do not fix it at a single call site, or the next
   endpoint fails a gate later.
9. **Sub-content units have no `generate` endpoint — they are authored, not
   generated,** unlike skills, problems and content units. `estimatedDuration`
   is in **minutes**, a positive integer, capped at 60000
   (`estimatedDurationSchema`). Assigning a skill to a sub-unit needs **both**
   `coreCompetencyModelId` and `levelId`, and neither comes from `CourseSkill`
   — verified against the backend models, not inferred: `CourseSkill`'s only
   columns are `id`, `courseId`, `coreCompetencyModelId`, `source`,
   `isRecommended`, `isSelected`, and its only associations are `Course` and
   `CoreCompetencyModel`. **It never carries a level — `CourseSkill.Level`
   does not exist and never can.** `Level` belongs to `CoreCompetencyModel`
   instead (a plain `hasMany` with no `as:`, so the serialised key is the
   default plural `Levels`), as `{ id, name, weight, coreCompetencyModelId }`;
   `RoleCcm` is the join of `CoreCompetencyModel` + `Level` +
   `CourseSubContentUnit` that `POST .../sub-content-units/:id/skills`
   actually creates. So the level is chosen **per sub-unit, at assignment
   time** — never inherited from the course skill. `coreCompetencyModelId`
   comes from `CourseSkill.CoreCompetencyModel.id` (already on hand from
   `course.CourseSkills`); `levelId` comes from
   `GET business/competencies/:coreCompetencyModelId`, which returns the
   competency including `Levels`, ordered by `weight` ascending —
   `getCompetencyLevels` in `src/api/competency.ts` wraps that call, and
   `planSubUnits` in `src/session/detail-plan.ts` resolves the caller's level
   name (by name, case-insensitively) against the fetched list, rejecting by
   name before any write; a competency with exactly one level lets the caller
   omit `level`, more than one without a `level` is rejected naming the
   available level names, and a competency with no levels at all is rejected
   as a data problem to fix in the app, not a client bug. This shipped as a
   real bug in 0.3.0 — the client read a `CourseSkill.Level` the backend
   never sends, so live assignment 400'd on the first skill of the first
   sub-unit, every time; fixed on `fix/pbl-skill-levels`. Ten skills is the
   hard ceiling per sub-unit (`subContentUnitSkillUnderLimit`).
   Creating a sub-unit, and assigning or changing its skills, both require the
   course to already be in `DRAFT` (`courseIsDraft`) — the same gate
   `content-units/generate` already put in front of everything past the
   outline. Artifact `generate` 409s when one already exists for that
   sub-unit; `regenerate` is a separate backend route that exists but this
   server deliberately never calls. `sortOrder` is server-assigned
   (`maxSortOrder + 1` on create) — never send one. Read from
   `backend/src/routes/business/business-course-sub-content-unit.route.ts`,
   `business-sub-content-unit-skill.route.ts`,
   `business-course-artifact.route.ts`, and
   `backend/src/validations/course-sub-content-unit.validation.ts`,
   `course-artifact.validation.ts`, `schemas/course-sub-content-unit.schema.ts`
   — items 1–8 above came from `api-docs`; this one didn't, so re-verify
   against the routes and validations themselves, not `api-docs`, if the
   backend changes.

## Working here

Standalone npm package — not part of a workspace. From this directory:

```bash
npm install
npm run build     # tsc → dist/
npm test          # vitest run, 247 tests
npx tsc --noEmit  # typecheck only
```

**Rebuild and commit `dist/` with any source change.** `/plugin install`
fetches files via `git-subdir` and never runs a build, so a source change
without a rebuilt `dist/` ships a stale server to everyone who installs.
`dist/` is deliberately not gitignored — see `.gitignore`.

To verify the built server without a client: start `dist/index.js` with staging
env vars and send it an MCP `initialize` then `tools/list` over stdin. It should
report `pbl-mcp` and list **14** tools.

## Testing lessons this codebase learned the hard way

Twice a test shipped that looked like it guarded a property but **could not
fail**. Both were caught in review; do not reintroduce the pattern.

- A negative assertion (`not.toContain(id)`) only has force when the code path
  that could produce the forbidden string is **reachable in the fixture**. The
  UUID-leak test used problems that all had titles, so `p.title ?? p.id` never
  reached the fallback and the test passed either way. The fix was a
  `title: undefined` fixture.
- A boundary test must use the value **at** the boundary. Three
  `assertRevisable` tests used `step: 'detail'`, where the correct and the
  buggy threshold agree, so an off-by-one went undetected.

When a test exists to catch a specific regression, **verify it by hand-patching
the code to that regression and confirming the test fails.** Restore the source
afterwards and confirm it passes.

## Known limitations and deferred work

Ruled ship-as-is by the whole-branch review, worth tickets:

- `resolve.ts`'s `resolveBusiness` and `machine.ts`'s `byName` are two drifted
  implementations of the same exact→prefix→ambiguity algorithm. `byName` also
  matches raw ids; `resolveBusiness` does not. Consolidating is the obvious
  cleanup.
- The spec promised a friendly message for the modifiable-status 403; no 403
  handling exists. `assertRevisable` covers the main path.
- **No request timeout.** A slow generation surfaces as a raw
  `UND_ERR_HEADERS_TIMEOUT`, not a `TangibleApiError`, and not something an
  operator can act on.
- `advance()` past `done` is unbounded — it re-saves and appends forever.
- `advance()`'s `if (!state.awaitingApproval)` guard is **unreachable** —
  nothing ever sets it false. It is not the reentrancy protection it appears to
  be, and there is none.
- The README says "nothing advances without an explicit `pbl_approve`";
  `pbl_revise` also advances. Substance holds (human-initiated), wording
  overstates.

## Never verified against a real backend

**Nearly none of this has run against a live Tangible instance.** All 247 tests
use mocked HTTP. A first staging run reached course creation and found that
`POST business/courses` does not return the course id where the client expects
it — see item 8 below. The README's "Before you trust it" checklist is the smoke test,
and it needs staging credentials that did not exist when this was built.

Until someone walks a real brief through to the outline gate, treat the
brief→context/skills mapping quality as **unknown**. That uncertainty was the
reason the `detail` layer was next in line; it has since been built, but —
like everything else in this section — it has not been run against a live
backend either.

## Conventions

- Conventional commits, `type(scope): subject`, scope `tangible-pbl`. **No
  co-author trailers** — neither this repo nor `tangible-internal-tools` uses
  them.
- ESM with NodeNext resolution: relative imports need the `.js` extension even
  though sources are `.ts`.
- `src/api/` owns wire format; `src/session/` owns gate progression; `src/tools/`
  owns MCP surface. `machine.ts` reaches the API only through `MachineDeps` —
  do not import API functions into it directly.
- No credentials in this repo. `.mcp.json` names variables as `${VAR}`
  references, expanded from each person's shell at launch.

## Current state

- The plugin is merged to `main`, installable, and listed correctly in
  `.claude-plugin/marketplace.json`. An earlier revision of this file
  documented a marketplace-entry corruption bug from the initial merge; that
  was fixed in `18e37a6` and is resolved.
- Releases are now automated: `release-please` derives each plugin's version
  from conventional commits, and `scripts/validate.mjs` fails the build if
  `package.json`, `.claude-plugin/plugin.json`, or the root
  `.claude-plugin/marketplace.json` are edited by hand. Do not bump versions
  yourself.
