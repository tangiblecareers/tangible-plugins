# @tangible/pbl-mcp

A stdio MCP server that builds a complete Problem-Based Learning (PBL) course
in Tangible from a single brief. It drives the Tangible business REST API
(`business/courses/*`) directly — logging in as a real user, exchanging that
for a business-scoped session, and walking the same pipeline the business
course-builder UI walks. The Tangible web app (`app.tangible.careers` or its
staging equivalent) is used only as a **viewer**: the API performs every
write, and every gate hands back a URL so the author can look at the real
course in the real UI before approving. Nothing in this server drives a
browser.

Eight approval gates keep a human in the loop at each expensive, irreversible,
or fan-out step. Nothing advances without an explicit `pbl_approve`.

## The eight gates

| gate | after | protects against |
|---|---|---|
| 1 | business login (`pbl_use_business`) | acting inside the wrong company's data |
| 2 | skills generated | everything downstream (problems, outline) is scoped by these — wrong skills, wrong course |
| 3 | problem selected | the scenario determines the entire outline; this is the **last** point the course's foundations can still change (see "The outline freeze" below) |
| 4 | outline built | last look before sub-units, resources and artifacts build on top of it |
| 5 | sub-content units created | the whole breakdown is resolved and validated against the live course before the first write — a bad content-unit or skill name fails here, not mid-creation; once sub-units exist, undoing them means deleting them by hand |
| 6 | artifacts generated | one artifact per sub-unit is generated against whatever was approved at gate 5 — review the generated (and any failed) artifacts before the next approval publishes the course |
| 7 | before publish (`pbl_publish`) | a state transition — learners can see the course afterwards |
| 8 | before invitations (`pbl_invite`) | sends real mail to real people; not undoable |

Every gate response opens with the active environment banner (`staging` or
`⚠ PRODUCTION`), a ledger of steps completed so far, what was just produced
(rendered readably, not raw JSON), and the review URL.

## Install

```
/plugin marketplace add tangiblecareers/tangible-plugins
/plugin install tangible-pbl@tangible
```

Then export your credentials (below) and restart Claude Code. `/mcp` should
show `pbl` connected; `pbl_list_businesses` is the quickest confirmation.

The plugin ships `dist/` already compiled. `/plugin install` fetches files
via `git-subdir` and never runs a build, so the built server is committed
deliberately — see `.gitignore` in this directory.

### From a local clone

If you have the repo checked out and want to run your working copy:

```bash
cd plugins/tangible-pbl
npm install
npm run build
```

Then point an `.mcp.json` at `plugins/tangible-pbl/dist/index.js` by absolute
path, with the same `env` block the plugin ships (see `.mcp.json` here).

## Configure

The plugin's own `.mcp.json` declares the server and every variable it needs.
You do not write that file — you supply the values it references, from your
own shell.

```jsonc
{
  "mcpServers": {
    "pbl": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/index.js"],
      "env": {
        "TANGIBLE_ENV": "${TANGIBLE_ENV:-staging}",
        "TANGIBLE_STAGING_API_URL": "${TANGIBLE_STAGING_API_URL:-https://tg-dev.arbyte.solutions/tangible/v1}",
        "TANGIBLE_STAGING_APP_URL": "${TANGIBLE_STAGING_APP_URL:-https://tg-dev.netlify.app}",
        "TANGIBLE_STAGING_EMAIL": "${TANGIBLE_STAGING_EMAIL}",
        "TANGIBLE_STAGING_PASSWORD": "${TANGIBLE_STAGING_PASSWORD}",
        "TANGIBLE_PRODUCTION_API_URL": "${TANGIBLE_PRODUCTION_API_URL}",
        "TANGIBLE_PRODUCTION_APP_URL": "${TANGIBLE_PRODUCTION_APP_URL:-https://app.tangible.careers}",
        "TANGIBLE_PRODUCTION_EMAIL": "${TANGIBLE_PRODUCTION_EMAIL}",
        "TANGIBLE_PRODUCTION_PASSWORD": "${TANGIBLE_PRODUCTION_PASSWORD}"
      }
    }
  }
}
```

Every value is a `${VAR}` reference, never a literal secret. Claude Code
expands them from each person's shell before launching the server, so this
file is safe to ship to the whole team: it names which variables are required
without ever holding a value. **No credential travels in this repo.**

The `${VAR:-default}` entries carry a sensible fallback — the staging URLs
and the production app URL are stable, non-sensitive, and known today, so a
teammate only has to set the ones that are genuinely theirs.
`TANGIBLE_PRODUCTION_API_URL` has no default for a different reason: the
production base URL is not finalized yet, so it is left for whoever
configures production to fill in — not because it is a secret.

Export what you need in your shell profile (e.g. `~/.zshrc`):

```bash
export TANGIBLE_STAGING_EMAIL="you@tangible.careers"
export TANGIBLE_STAGING_PASSWORD="…"
export TANGIBLE_PRODUCTION_API_URL="…"
export TANGIBLE_PRODUCTION_EMAIL="you@tangible.careers"
export TANGIBLE_PRODUCTION_PASSWORD="…"
```

Then reload the shell (`source ~/.zshrc`) before starting your MCP client.

**Role requirement:** the account needs `ADMIN` or `MANAGER` on the business
being authored into. `EDUCATOR` is restricted to courses that account
created itself, which is not sufficient for the full pipeline this server
drives (creating a course, generating skills/problems/outline, publishing,
inviting).

## Tool reference

14 tools, in three groups.

**Context** — establish who you are and where you're working

| tool | does |
|---|---|
| `pbl_whoami` | Show the active Tangible environment, business and role. |
| `pbl_list_businesses` | List the businesses this account can author courses for. |
| `pbl_use_business` | Log in to a business by name. This is gate 1 — it confirms which company you are authoring into. |
| `pbl_use_environment` | Switch between staging and production. Clears the login; refuses while a session is open. |

**Session** — the gated course-builder pipeline

| tool | does |
|---|---|
| `pbl_start_course` | Create a course from a brief and stop at the first gate. Pass the full text of the source document as `brief`. |
| `pbl_status` | Show a course’s progress, or list every course — open and closed — in this environment. |
| `pbl_resume` | Reopen a course by name, re-resolve its business, and report anything that changed in the web app since (title edited, course already `DRAFT`/`PUBLISHED`/`ARCHIVED`). Never writes anything — it only reads and reports. |
| `pbl_approve` | Advance the session exactly one step. This is the only way forward — nothing advances on its own. |
| `pbl_revise` | Redo a step with changes — pass `contexts` to add new context items when step is "context". Context, skills and problems are frozen once the outline exists. |
| `pbl_abort` | Close the session. The course is left exactly as it is — closing marks the record `closed` in its memory file; it is never deleted. |

`pbl_approve`'s `subUnits` field (step `"outline"` → `"detail"` only) is the
whole sub-content-unit breakdown for the course, one entry per sub-unit:
`{ contentUnit, title, description?, minutes?, skills[] }`. `contentUnit` and
every entry of `skills` are names — resolved against the outline's content
units and the course's selected skills — never ids. `minutes` is estimated
duration **in minutes**, mapped onto the backend's `estimatedDuration`. The
whole breakdown is validated (`planSubUnits` in `src/session/detail-plan.ts`)
before the first sub-unit is created, so an unknown content-unit name, an
unknown or level-less skill name, more than ten skills on one sub-unit, or an
out-of-range `minutes` fails the call with nothing created — never a
partially-built course with no way to tell which half succeeded.

`pbl_approve`'s `instruction` field (step `"detail"` → `"artifacts"` only) is
an optional steer applied identically to every artifact generated at that
gate — there is no per-sub-unit instruction. One artifact is generated per
sub-unit; a 409 (an artifact already exists) counts as satisfied, and a
failure on one sub-unit does not stop the rest — the gate always advances,
and its response lists both what generated and what failed, by title.

`pbl_revise`'s `contexts` field (step `"context"` only, same item shape as
`pbl_start_course`'s): each new item is created **un-selected** on the
backend, then selected immediately by the tool so it counts toward the next
skills generation. Selections do not all behave the same way, though —
`LEARNING_OUTCOME` and `LEARNER_PROFILE` **accumulate** (a new item adds
alongside whatever was already selected in that category), while `DURATION`
is server-enforced **single-select** (adding a new one automatically
deselects the previous one, via the server's own transaction). Omit
`contexts` to just regenerate skills against the unchanged context. A caller
expecting all-category replacement will end up with a course carrying
contradictory learner profiles if they don't account for the accumulate
behavior on those two categories.

**Direct** — operate on any course, session or not

| tool | does |
|---|---|
| `pbl_open_in_app` | Return the Tangible app URL for a course, for eyes-on review. |
| `pbl_add_resource` | Attach a link or text resource to a sub-content unit. |
| `pbl_publish` | Publish a DRAFT course — checks locally first and names which content units are still missing a sub-unit with a skill, instead of surfacing Tangible's bare 400. Learners can see it afterwards. |
| `pbl_invite` | Invite learners by email — this sends real mail and cannot be undone. |

`pbl_add_resource` takes `contentUnit` and `subUnit` **names**, not ids —
resolved with the same exact→prefix→ambiguity `byName` lookup used
everywhere else in this server. Those names come from `pbl_status`: once a
course has passed the `detail` gate, its response includes a breakdown
listing every content unit and, indented under each, its sub-content units by
title — that listing is what makes this tool reachable at all.

**Breaking change:** earlier revisions of this tool took `contentUnitId` and
`subUnitId`. Any saved `pbl_add_resource` invocation from before the detail
layer landed needs its arguments changed to the `contentUnit`/`subUnit` names
shown by `pbl_status`.

## Course memory

Every course started with `pbl_start_course` gets a durable, human-readable
record on disk:

```
~/.tangible-pbl-mcp/courses/<env>/<slug>.md
```

`<env>` is `staging` or `production`; `<slug>` is the course id shown by
`pbl_status` (derived from the course title, or the first few words of the
brief when the course has no title yet). The file is plain markdown — open
it, read it, or search across it like any other file.

Layout:

```
---
course: "..."
env: "staging"
courseId: "..."
business: "..."
step: "skills"
awaitingApproval: true
status: "active"
created: "2026-08-05T10:00:00.000Z"
updated: "2026-08-05T10:12:00.000Z"
---

# <title>
<env> · <business>

## Brief
<the full brief text passed to pbl_start_course>

## Log

### 10:12 · skills — approved
Kept 6 of 11.

## Notes
```

- The frontmatter block is rewritten on every `pbl_approve`/`pbl_revise`/
  `pbl_abort` call — it is the only part of the file the tool fully owns.
- `## Log` is append-only: each call adds one timestamped (UTC `HH:MM`) entry
  recording the step, the human decision, and what the backend produced.
  Existing entries are never edited, reordered, or removed.
- `## Notes` is yours. The tool creates it empty and never writes to it
  again — put anything you want below that heading and it survives every
  future save.
- Closing a course with `pbl_abort` marks it `closed` in the frontmatter; the
  file, the brief, and every log entry stay on disk exactly as they were.
  There is no delete tool — remove a record yourself with `rm` if you want it
  gone for good.

## How a Google Drive brief gets in

This server does not talk to Google — there is no Drive OAuth here and none
is planned for v1. Instead, the **host agent** (the MCP client, e.g. Claude
Code or Claude with a Drive connector configured) reads the Drive document
itself and passes the extracted text as `pbl_start_course`'s `brief`
argument. `sourceUrl` is accepted alongside it purely for provenance — it is
not fetched or verified by the server.

```
Drive link → host agent's own Drive connector → text → pbl_start_course({ brief, sourceUrl })
```

This means the flow **requires a Drive-connected host**. A headless
invocation, or a host without Drive access, cannot pull a brief from Drive on
its own — you would need to paste the brief text in some other way.

## The outline freeze

**`content-units/generate` (the call behind gate 4, the outline step) flips
the course `INITIALIZING → DRAFT` server-side.** This is not a separate
call — generating the outline *is* what moves the course out of
`INITIALIZING`.

Context, skills, and problems all require the course to be in
`INITIALIZING`. Once the outline is generated, **all three are permanently
frozen** — `pbl_revise` refuses to touch `context`, `skills`, or `problems`
after that point, with an explanation, rather than letting the API return a
bare 403. The only way to change them is to start a new course from an
adjusted brief.

This makes **gate 3 (problem selection) the highest-stakes gate in the whole
flow** — it is the last point at which the course's foundations can still
change.

## Current limitations

Read this before using this against a real business. It is not a bug in
what's shipped; it's a known, deliberate gap.

- **Credentials are real user passwords, not scoped tokens.** The `env`
  values in your MCP config are a full login for a real Tangible account,
  carrying that account's full business role (`ADMIN`/`MANAGER`) — not a
  narrowly-scoped API token. The `${VAR}` pattern above keeps the password
  out of git, but it still sits in plaintext in your shell profile on disk.
  The correct long-term fix is a personal-access-token concept on the
  Tangible backend, which does not exist today. **Raise the PAT gap before
  this tool goes team-wide.**

## Before you trust it: staging smoke-test checklist

This server has **not yet been run end-to-end against staging** — Tasks 1–9
built and unit-tested it (the full suite passes, mocked HTTP throughout, no
live API in CI), but no one has walked the real pipeline with real staging
credentials. Whoever gets staging credentials first should run this checklist
before relying on the tool for anything real, and should treat any surprise
here as a bug report, not user error:

1. **`pbl_list_businesses`** — confirm it returns business **names only**, no
   UUIDs anywhere in the output.
2. **`pbl_use_business`** — confirm the response states the confirmed role
   (`ADMIN`/`MANAGER`) and the `staging` banner (not `PRODUCTION`).
3. **`pbl_start_course`** — use a real brief (paste real document text, not a
   placeholder) and pass at least one context item per category
   (`DURATION`, `LEARNING_OUTCOME`, `LEARNER_PROFILE`).
4. **`pbl_approve` × 5** — call it through skills → problems → outline →
   detail → artifacts. Verify each call advances **exactly one** step of the
   ledger — no skipping, no double-advancing. At the `detail` gate, pass a
   real `subUnits` breakdown; at `artifacts`, try an optional `instruction` if
   you want to test the steer.
5. **Open the review URL** returned by the gate and confirm what's on screen
   in the Tangible app matches what the gate response said was produced
   (skills, problem scenarios, outline units, sub-content units, artifacts).
6. Only after all of the above hold, call `pbl_approve` once more — this is
   the call that actually publishes the course, since the sub-units and
   skills created at the `detail` gate satisfy Tangible's publish
   precondition. Treat a failure here as a bug report, not an expected
   outcome.

Do not skip straight to `pbl_publish` or `pbl_invite` on a business anyone
depends on — invitations send real mail and cannot be undone.

## Development

This plugin is a standalone npm package — it does not belong to a workspace.
Run everything from `plugins/tangible-pbl/`:

```bash
npm install
npm run build     # tsc -p tsconfig.json  → dist/
npm test          # vitest run
npm run dev       # tsc --watch
```

Typecheck without emitting: `npx tsc --noEmit`.

**Commit `dist/` with any source change.** `/plugin install` fetches files
and never builds, so a source change without a rebuilt `dist/` ships a stale
server to everyone who installs. Run `npm run build` before committing.

To verify the built server end to end without a client, start it with staging
env vars and send it an MCP `initialize` followed by `tools/list` over stdin —
it should report `pbl-mcp` and list 14 tools.

### History

This server was built in the `tangible-internal-tools` repo across ten
task-scoped increments with independent review at each step, then moved here
for distribution. The design rationale, the full state machine, the six-gate
reasoning, and the backend constraints discovered during planning live in that
repo under `docs/superpowers/specs/2026-08-03-pbl-mcp-design.md` and
`docs/superpowers/plans/2026-08-03-pbl-mcp.md`.

Note the plan document contains one known bug that was corrected in code: its
`assertRevisable` used `indexOf('detail')` where the correct boundary is
`indexOf('outline')`. The plan is kept as a historical record and deliberately
not retro-edited; `src/session/machine.ts` is the source of truth, and three
tests pin that boundary.
