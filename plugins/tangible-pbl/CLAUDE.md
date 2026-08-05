# CLAUDE.md — tangible-pbl

Guidance for agents working on this plugin. Read this before changing anything.

## What this is

An MCP server (stdio) that authors a Problem-Based Learning course in the
Tangible product from a single brief. It drives Tangible's business REST API
directly and stops at **six human approval gates**. The Tangible web app is
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

## Working here

Standalone npm package — not part of a workspace. From this directory:

```bash
npm install
npm run build     # tsc → dist/
npm test          # vitest run, 161 tests
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

**Cannot publish yet.** The `detail` step is a deliberate no-op — it creates no
sub-content units, and Tangible refuses to publish a course whose content units
lack a sub-unit with a skill. `pbl_publish` returns the backend's own 400. The
`detail` gate says so in its output. **This is the main follow-on: implement
sub-content-unit creation, resources, and artifact generation.**

**`pbl_add_resource` is currently undrivable** — nothing surfaces a
`contentUnitId` or `subUnitId`, and nothing creates a sub-content unit. It will
become usable when the `detail` layer lands.

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

**No part of this has run against a live Tangible instance.** All 161 tests use
mocked HTTP. The README's "Before you trust it" checklist is the smoke test,
and it needs staging credentials that did not exist when this was built.

Until someone walks a real brief through to the outline gate, treat the
brief→context/skills mapping quality as **unknown**. That is the question that
decides whether the `detail` layer is worth building.

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
