# tangible-pbl course memory — design

Date: 2026-08-05
Status: approved, not yet implemented
Applies to: `plugins/tangible-pbl`

## Problem

A `tangible-pbl` session is a pointer file and nothing else. `SessionStore`
writes `~/.tangible-pbl-mcp/sessions/<env>/<id>.json` holding `id`, `env`,
`courseId`, `businessId`, `businessName`, `brief`, `sourceUrl`, `step`,
`awaitingApproval` and `history`. Four of those — `businessId`, `brief`,
`sourceUrl`, `history` — are written and never read again. The plugin's own
`CLAUDE.md` lists them as known dead data.

Three consequences:

1. **There is no record of a finished course.** `pbl_abort` deletes the file.
   Once a course is done, nothing on disk says it ever happened, what brief
   produced it, or which skills were chosen.
2. **Resuming means re-deriving.** A session interrupted on Tuesday offers
   nothing on Thursday beyond a step name. Why a problem scenario was
   regenerated, what the rejected skills were and why — all of it lives only in
   a chat transcript that is gone.
3. **Nothing carries forward between courses.** The contexts that produced a
   good outline for one course are not available when authoring the next one
   for the same business.

The pipeline stops at six human approval gates precisely because the decisions
at those gates are consequential and hard to reverse. Recording only the step
name discards the very thing the gates exist to capture.

## Goals

- Every course leaves a durable, human-readable record of what was built and
  why, which survives the session being closed.
- A course can be resumed later — or on another machine — without re-deriving
  where it was.
- The decisions that steer generation (the brief, the context items) are
  captured so a revise is better informed and a proven context set can be
  reused on the next course.

## Non-goals

- **Improving a single generate call.** See "The generation-feedback limit".
- **Mirroring course content.** The record holds decisions, not a copy of every
  generated skill and problem. Rejected candidates stay re-fetchable from the
  API.
- **A team-shareable artifact.** Files stay under `~/.tangible-pbl-mcp/`,
  per-machine and private. Explicitly ruled out during design.
- **Migrating existing sessions.** The pipeline has never completed a run
  against a live backend, so no session files exist to migrate. Any stale
  `sessions/*.json` is ignored, not converted.

## The generation-feedback limit

Worth stating plainly, because it bounds what this feature can deliver.

`course-skills/generate`, `course-problems/generate` and
`content-units/generate` validate **only `courseIdInParams`**. They accept no
body. Generation runs server-side from the course's own stored state, so no
amount of accumulated memory can be passed into a generate call.

The client controls exactly two generation inputs, both at the front of the
pipeline and both frozen once the outline exists:

- `POST business/courses` takes `{ prompt }` — the brief, verbatim.
- `POST …/course-contexts` takes `{ category, value }` — the context items.

So memory improves generation *indirectly*: it records what was fed in and what
that produced, which informs the next revise and the next course. Feeding
context into a running generation would require the backend to accept
generation hints, which is a separate change and out of scope here.

## Decisions taken

**The memory is a decision log, not a content mirror.** It records the brief,
the contexts, what was selected at each gate, what a revise changed and why.
Not the full candidate lists — those bury the decisions in noise and duplicate
the backend.

**The backend stays authoritative for content.** On resume the live course is
fetched and compared against the memory, and differences are reported. The
memory never overrides the API and never auto-fixes.

**One markdown file per course replaces the JSON store.** Chosen over keeping
JSON and adding a sibling markdown file. The single-file model is the cleaner
mental model — the thing you read is the thing that resumes — at the cost of
replacing a tested storage layer. The three risks that carried are each
designed out below rather than accepted.

## Design

### Storage and identity

One file per course:

```
~/.tangible-pbl-mcp/courses/<env>/<slug>.md
```

The slug is the session identifier. `pbl_status` and `pbl_resume` take
`intro-to-systems-thinking`, not an opaque id — consistent with the plugin's
names-in-names-out rule.

The slug derives from `Course.title`, kebab-cased. `title` is optional on the
API's `Course`, so the fallback is the first five words of the brief. If the
resulting slug is taken, append `-2`, then `-3`, and so on.

`assertSafeId`'s `/^[A-Za-z0-9_-]+$/` is kept exactly as it is and applied to
the slug. A kebab-case slug satisfies it, and it remains the guard against path
traversal through a caller-supplied identifier.

Environment namespacing (`courses/<env>/`) is preserved from the current
design. It is one of the layered environment-isolation measures `CLAUDE.md`
requires be kept intact.

### File shape

```markdown
---
course: "Intro to Systems Thinking"
env: "staging"
courseId: "…"
business: "Acme Corp"
step: "outline"
awaitingApproval: true
status: "active"
created: "2026-08-05T10:00:00Z"
updated: "2026-08-05T11:30:00Z"
---

# Intro to Systems Thinking
staging · Acme Corp

## Brief
<the brief, verbatim>

## Log
### 10:12 · skills — approved
Kept 6 of 11: Systems Mapping, Feedback Loops, …
Dropped Statistical Inference — out of scope for a 6-week intro.

### 10:20 · problems — revised
Regenerated: the first set assumed a corporate audience; the brief is for
students.

## Notes
<free text; the tool never touches this section>
```

`status` is one of `active`, `closed` or `published`.

### Two fields deliberately dropped

**`businessId` is not persisted.** Resume re-resolves the business by name via
`listBusinesses`. This removes a documented dead field, keeps a UUID out of a
file a human reads, and makes a memory portable to another machine.

**`history: string[]` is not persisted.** The Log section replaces it, with the
detail the string array never carried. This is the second dead field
`CLAUDE.md` flags.

`courseId` is retained. Every API call needs it, and the review URL written
into this same file already contains it, so it introduces no exposure beyond
the exception `CLAUDE.md` already documents.

### Frontmatter format

Deliberately constrained so a real YAML parser is unnecessary — this package
depends on `zod` and the MCP SDK and nothing else.

- Flat `key: value` pairs only. No nesting, no lists, no multi-line values.
- Values are JSON-encoded on write (`business: "Acme: Inc"`) and JSON-decoded
  on read, so colons, quotes and unicode round-trip safely.
- Booleans and numbers are written bare and parsed by `JSON.parse` too.
- Anything free-form — the brief, rationale — lives in the body, where it
  cannot break parsing.

Parsing is a `^---\n(.*?)\n---` match plus a per-line `key: value` split: about
twenty lines.

### When a log entry is written

Exactly one entry per human decision, and none otherwise:

| Operation | Entry |
|---|---|
| `pbl_start_course` | Creates the file; writes the Brief section. No Log entry. |
| `pbl_approve` | One entry: the step approved and what was selected. |
| `pbl_revise` | One entry: the step revised, what changed, and the stated reason. |
| `pbl_publish` | One entry; sets `status: published`. |
| `pbl_invite` | One entry: how many learners. No addresses recorded. |
| `pbl_abort` | One entry; sets `status: closed`. |
| `pbl_status`, `pbl_resume`, `pbl_whoami` | None. Reads never write. |

A save that carries no new entry — a frontmatter-only update such as
`awaitingApproval` flipping — rewrites the frontmatter and leaves the body
untouched.

### Writing

The file is rewritten on every save but must behave as append-only. The
algorithm:

1. Read the existing file if present; split into frontmatter and body.
2. Recompute the frontmatter block from current state.
3. If this save carries a new log entry, insert it immediately before the
   `## Notes` heading, or append it at the end of the body when that heading is
   absent.
4. Write frontmatter + body to `<file>.tmp`, then `rename()` over the target.

Two properties follow. **No torn files:** `rename()` is atomic on POSIX, so a
crash leaves either the previous file or the complete new one. **No clobbered
edits:** every byte outside the frontmatter block and the inserted entry passes
through verbatim, and existing log entries are never rewritten. A revise
appends a second entry rather than overwriting the first, which is what "why
did this change" requires.

### Resume and reconcile

`pbl_resume <slug>`:

1. Read the memory file.
2. Re-resolve the business by name; log in to it.
3. `GET business/courses/:courseId`.
4. Compare live course against the memory.
5. Report differences; set the active session.

Reconciliation is a pure function of `(memory, liveCourse) → difference[]`, so
it is testable without HTTP. It reports and never auto-fixes:

```
Resumed "Intro to Systems Thinking" (staging · Acme Corp)
Memory says: outline, awaiting approval
Backend says: DRAFT, 6 content units

⚠ Memory recorded 4 content units; the course now has 6.
  Someone edited this in the web app. The backend is authoritative.
```

The course-status comparison earns its place. If the memory says `step: skills`
but the live course is `DRAFT`, the outline already exists and contexts, skills
and problems are permanently frozen — the irreversible transition documented in
`CLAUDE.md`. Resuming without that check produces confusing 403s several calls
later instead of one clear message now.

### Listing

No new listing tool. `pbl_status` with no arguments already lists sessions;
once memories outlive `pbl_abort`, that list *is* the list of courses made. It
gains a status column and stops filtering out closed courses.

`pbl_abort` sets `status: closed` and stops deleting the file.

Net tool count: 13 → 14, `pbl_resume` being the only addition.

### Modules

| File | Responsibility |
|---|---|
| `src/session/memory.ts` | Frontmatter parse/serialize, slug generation, the store. Replaces `store.ts`. |
| `src/session/reconcile.ts` | Pure `(memory, liveCourse) → difference[]`. |
| `src/tools/session.ts` | `pbl_resume`; `pbl_status` and `pbl_abort` updated. |

The store keeps `save`, `load` and `list` with their current shapes, so
`machine.ts` needs no logic change and the `MachineDeps` boundary `CLAUDE.md`
requires is untouched.

`delete` is removed. `pbl_abort` was its only caller, and abort now closes
rather than deletes — keeping an uncalled method would reintroduce exactly the
dead code this spec sets out to remove. Nothing in the design deletes a memory
file; that is the user's to do with `rm`.

## Risks and accepted limitations

- **Replacing a tested storage layer.** `store.ts` has 11 passing tests. They
  are rewritten against the new format rather than deleted; the method shapes
  are preserved to contain the blast radius to serialization.
- **A hand-edited frontmatter block can break parsing.** The body is protected;
  the frontmatter is not. A malformed block makes the course unreadable until
  fixed. Mitigation: parse failures name the file and the offending line rather
  than throwing a raw JSON error, and `pbl_status` skips an unreadable file
  instead of failing the whole listing — the behaviour `list()` already has.
- **Slug collisions are resolved at creation, not tracked.** Renaming a course
  in the web app does not rename its memory file. The file keeps the slug it
  was created with; `course:` in the frontmatter may drift from the live title.
  Reconcile reports it.
- **Memory is per-machine.** Two people authoring the same course keep separate
  records, and neither sees the other's. Dropping `businessId` makes a file
  portable if copied by hand, but nothing syncs it.
- **`status: published` is currently unreachable.** `pbl_publish` sets it, but
  publishing fails until the `detail` layer creates sub-content units. The
  value is defined now so the log does not need reshaping later.
- **Nothing deletes a memory file.** Closed courses accumulate in
  `courses/<env>/` indefinitely. At a handful of courses per author this is a
  non-issue; if it ever stops being one, the fix is a listing filter, not a
  reaper.

## Verification

The design is implemented correctly when all of the following hold:

1. Completing a course and calling `pbl_abort` leaves a readable markdown file;
   `pbl_status` lists it with `closed`.
2. A frontmatter value containing a colon and a double quote round-trips
   through save and load unchanged.
3. Text added by hand under `## Notes`, and an existing `## Log` entry, both
   survive a subsequent gate approval byte-for-byte.
4. No `.tmp` file remains after a successful save.
5. A slug that would collide with an existing file becomes `<slug>-2`.
6. A session id containing `../` is rejected by `assertSafeId`.
7. `pbl_resume` on a course whose backend state has moved on reports the
   difference and does not overwrite it.
8. `pbl_resume` re-resolves the business by name, with no `businessId`
   anywhere in the file.
9. Each new test is verified by breaking the code it covers and confirming it
   fails — the practice `plugins/tangible-pbl/CLAUDE.md` mandates after two
   could-not-fail tests shipped.
