# tangible-pbl detail layer — design

Date: 2026-08-06
Status: approved, not yet implemented
Applies to: `plugins/tangible-pbl`

## Problem

`pbl_start_course` walks a brief through context, skills, problems and an
outline, and then stops. The `detail` step is a deliberate no-op: it creates no
sub-content units, so `pbl_publish` returns the backend's own 400 and the course
can never reach a learner. `plugins/tangible-pbl/CLAUDE.md` has listed this as
"the main follow-on" since the plugin was built.

A live staging run reached the outline gate and confirmed the shape of the gap:
four content units exist, and nothing below them does. Four capabilities are
missing, all of which the backend already supports:

- **Sub-content units** — nothing creates them.
- **Skills on sub-units** — `selectSkills` picks from the course-level list;
  nothing maps a skill onto an individual sub-unit.
- **Resources** — `pbl_add_resource` exists but is undrivable, because nothing
  surfaces a `subUnitId` and no sub-unit exists to attach to.
- **Artifacts** — no tool touches them at all.

The reason none of this was built is that the API was unknown. It is not
unknown any more; the contracts below were read from
`backend/src/routes/business/**` and `backend/src/validations/**`.

## Backend contracts

All paths are relative to `business/courses/:courseId`, and every route below
already has its ancestors' existence and ownership checks applied.

| Operation | Method and path | Body |
|---|---|---|
| Create sub-unit | `POST content-units/:cuId/sub-content-units` | `{ title, description?, estimatedDuration? }` |
| List sub-units | `GET content-units/:cuId/sub-content-units` | — |
| Reorder sub-units | `PATCH content-units/:cuId/sub-content-units/reorder` | — |
| Assign skill | `POST …/sub-content-units/:suId/skills` | `{ coreCompetencyModelId, levelId }` |
| List sub-unit skills | `GET …/sub-content-units/:suId/skills` | — |
| Remove skill | `DELETE …/sub-content-units/:suId/skills/:coreCompetencyModelId` | — |
| Generate artifact | `POST …/sub-content-units/:suId/artifact/generate` | `{ instruction?, title?, selectedResourceIds? }` |
| Get artifact | `GET …/sub-content-units/:suId/artifact` | — |
| Add resource | `POST …/sub-content-units/:suId/resources` | `{ title, type, url?, content? }` (already implemented) |

Constraints that shape the design, each read from the source rather than
inferred:

1. **Sub-content units have no `generate` endpoint.** Skills, problems and
   content units are all AI-generated server-side; sub-units are authored. This
   is the first step in the pipeline where something has to write the content
   rather than approve it.
2. **`title` is required; `description` and `estimatedDuration` are optional.**
   `title` is 1–255 chars, `description` up to 20 000, `estimatedDuration` is a
   positive integer in **minutes**, capped at 60 000.
3. **Assigning a skill requires both `coreCompetencyModelId` and `levelId`**,
   both UUIDs, both required.
4. **Ten skills maximum per sub-unit**, enforced by
   `subContentUnitSkillUnderLimit`.
5. **Sub-unit creation requires the course in `DRAFT`** (`courseIsDraft`), which
   holds after the outline gate.
6. **Artifact generation 409s when an artifact already exists.** `regenerate` is
   the separate path for replacing one.
7. **`sortOrder` is server-assigned.** The client controls order only through
   creation sequence and the explicit reorder route.

## Goals

- A course can be driven from brief to publishable without leaving the plugin.
- Every sub-unit carries at least one skill, so `pbl_publish` stops failing on
  its documented precondition.
- Nothing irreversible happens without an explicit human-initiated call.

## Non-goals

- **Reordering.** `PATCH /reorder` stays unused; creation order is the order.
  Adding a reorder tool before anyone has wanted one is speculative.
- **Editing or deleting sub-units.** `pbl_revise` covers "this is wrong, redo
  it" for earlier gates; the same at the detail layer means a new course. Update
  and delete routes exist and stay unused.
- **Removing an assigned skill.** The `DELETE` route stays unused for the same
  reason.
- **Artifact regeneration.** `generate` only. A 409 means one already exists,
  which is a satisfied precondition, not a failure.
- **Authoring resources automatically.** `pbl_add_resource` stays a direct tool;
  this design only makes it reachable.

## Decisions taken

**The agent drafts the breakdown; the tool call is the approval.** Sub-units
cannot be generated, so somebody must author them. The agent proposes a
breakdown in conversation from the approved outline and problem; the human reads
it and says go; that instruction becomes the `pbl_approve` call that creates
them. This keeps the product's premise intact — `advance()` still moves exactly
one step per invocation, from exactly two call sites — without inventing a
two-phase gate, which would have broken it.

**Skills are addressed by name.** The caller passes skill names per sub-unit;
the plugin resolves each to `coreCompetencyModelId` + `levelId` from the
course's selected skills. Names in, names out — no UUID reaches the caller, and
the existing `byName` resolution behaviour (exact, then unique prefix, then
ambiguity error) is reused rather than reinvented.

**Artifacts get their own gate.** Generating an artifact is a real AI call per
sub-unit; twelve sub-units is twelve calls. Putting them behind their own
approval keeps expensive irreversible work behind an explicit human call, and
means a failure part-way through does not also cost the sub-unit creation that
preceded it.

## Design

### Step order

One step is inserted:

```
context → skills → problems → outline → detail → artifacts → publish → invite → done
```

`STEP_ORDER` in `src/session/machine.ts` gains `'artifacts'` between `'detail'`
and `'publish'`. Existing memory files name their step as a string, so a file
recording `step: outline` still loads unchanged; only the index shifts, and
every comparison in the codebase is by `indexOf` against the same array.

`reconcile`'s freeze check compares against `'outline'` and is unaffected.

### Advancing to `detail`

`pbl_approve(sessionId, subUnits)` where `subUnits` is an array of:

```ts
{
  contentUnit: string;   // name of the content unit this belongs under
  title: string;
  description?: string;
  minutes?: number;      // maps to estimatedDuration
  skills: string[];      // skill names, resolved against the course
}
```

The machine, through `MachineDeps`, then:

1. Resolves each `contentUnit` name to a content unit via the existing `byName`
   helper, so a typo names the available units rather than 404ing.
2. Resolves each skill name to `{ coreCompetencyModelId, levelId }` from the
   course's **selected** skills.
3. Creates each sub-unit, then assigns its skills.
4. Returns a `Produced` of kind `detail` carrying what was created.

Validation happens **before any write**: unknown content unit, unknown skill,
more than ten skills on one sub-unit, or a sub-unit with no skills all fail with
a message naming the offender and nothing is created. A sub-unit with no skills
is rejected because publish requires one, so allowing it only defers the failure
to a worse place.

`estimatedDuration` is minutes. The tool description says so explicitly, because
"duration" with no unit is the kind of ambiguity that ships as hours.

### Advancing to `artifacts`

`pbl_approve(sessionId, instruction?)` generates one artifact per sub-unit,
in creation order, reporting progress per sub-unit through the existing
`onProgress` channel.

- A **409** is treated as already-satisfied and counted as a success, because
  the goal is "every sub-unit has an artifact", which a pre-existing one meets.
- Any other failure is recorded and generation **continues** to the next
  sub-unit. The gate then reports which succeeded and which failed. Aborting
  the whole gate on one failure would discard the successful generations, and
  there is no way to resume mid-gate.
- The optional `instruction` is passed to every call, so the agent can steer
  tone or format once for the whole course.

### Making `pbl_add_resource` reachable

`pbl_status` gains a sub-unit listing for a course past `detail`: content unit
name, then its sub-units by name with their assigned skills. `pbl_add_resource`
takes `contentUnit` and `subUnit` **names** rather than ids, resolved the same
way as everywhere else. This is what turns an existing dead tool into a usable
one; no new tool is needed.

### Publish precondition

`pbl_publish` checks locally before calling: every content unit must have at
least one sub-unit, and every sub-unit at least one skill. When the check fails
it names the content units that are short, rather than surfacing the backend's
bare 400. This is the documented precondition from `CLAUDE.md` item 5, and it is
the failure the plugin has been hitting since it was written.

### Course memory

The detail and artifacts gates each write one log entry, like every other gate:
what was created, under which content unit, with which skills. Sub-unit titles
and skill names only — no ids, consistent with the memory being a decision log
rather than a content mirror.

### Modules

| File | Responsibility |
|---|---|
| `src/api/subunits.ts` | New. Sub-unit create/list, skill assign/list, artifact generate/get. Wire format only. |
| `src/api/courses.ts` | `addResource` unchanged; it already matches the contract. |
| `src/session/machine.ts` | `STEP_ORDER` gains `artifacts`; two new `advance` cases; `MachineDeps` gains the calls they need. |
| `src/session/ledger.ts` | Renders the two new `Produced` kinds. |
| `src/tools/session.ts` | `subUnits` and `instruction` inputs; sub-unit listing in `pbl_status`. |
| `src/tools/direct.ts` | `pbl_add_resource` takes names; `pbl_publish` gains the precondition check. |

`machine.ts` continues to reach the API only through `MachineDeps`.

## Risks and accepted limitations

- **`levelId` may be absent.** `CourseSkill.Level` is optional in the API type,
  and assignment requires a `levelId`. A selected skill without a level cannot
  be assigned; the plugin names it in the pre-write validation rather than
  failing mid-creation. Whether this happens in practice is unknown — no course
  has reached this gate against a live backend.
- **Partial creation is possible at the `detail` gate.** Validation is complete
  before the first write, but a network failure between sub-unit three and four
  leaves three created. The gate reports exactly what landed. There is no
  transaction and no rollback route.
- **Artifact generation is slow and unmeasured.** Twelve sequential AI calls
  with no request timeout in the client (a known, separately-tracked gap) could
  run long. Progress reporting is the only mitigation in this design.
- **The whole design is unverified against a live backend.** Every contract here
  was read from backend source, not exercised. The first real run may find a
  response shape mismatch of the same kind that `asCourse` now absorbs for
  courses.
- **No reorder.** If the agent proposes sub-units in the wrong order, the fix is
  a new course, not a reorder call.

## Verification

The design is implemented correctly when all of the following hold:

1. Approving at `outline` with a valid `subUnits` array creates every sub-unit
   under the named content unit, with its skills assigned.
2. An unknown content-unit name, an unknown skill name, a sub-unit with eleven
   skills, or a sub-unit with none, each fail before anything is created, naming
   the offender.
3. A skill name is resolved by exact match, then unique prefix, and an ambiguous
   prefix reports the candidates.
4. A selected skill with no `Level` is reported as unassignable, by name, before
   any write.
5. Approving at `detail` generates one artifact per sub-unit; a 409 counts as
   success; one failure does not stop the rest, and the gate reports both lists.
6. `pbl_status` on a course past `detail` lists sub-units by name with their
   skills, and `pbl_add_resource` accepts those names.
7. `pbl_publish` refuses, naming the content units at fault, when any content
   unit has no sub-unit or any sub-unit has no skill.
8. No UUID appears in any output of the new paths, including error messages.
9. `advance()` still has exactly two call sites and still moves exactly one step
   per invocation.
10. Each new test is verified by breaking the code it covers and confirming it
    fails — the practice `CLAUDE.md` mandates after four could-not-fail tests
    were caught during earlier work.
