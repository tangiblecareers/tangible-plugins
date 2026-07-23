---
name: tangible-linear
description: Use when creating, updating, or organizing any work in Tangible Careers' Linear workspace — issues, projects, labels, sprints, dependencies, or gathering an engineer's current work. Applies Tangible's team conventions.
---

# Tangible Careers — Linear conventions

Apply these whenever doing Linear work for **Tangible Careers**. Act with the Linear MCP tools. Full detail in [guidelines.md](guidelines.md) — this is the operational summary.

**Read [`workspace.json`](../../workspace.json) first** — it holds the live teams, people, the label taxonomy (incl. `security`/`performance`), the sprint anchor, and the current initiative list. Treat it as the convention source of truth, and query Linear live (`list_*`) for current state (which projects/issues/sprint-labels exist right now).

## Non-obvious rules (this is where agents go wrong — get them right)

1. **Sprints are `sprint/YYYY-MM-DD` LABELS, not Linear Cycles.** We do NOT use Cycles. A sprint's label is named for its **first day (Monday)** in ISO format, under the `sprint/` group — e.g. `sprint/2026-06-29`. Sprint Mondays are anchored on **`2026-06-15`** (every sprint is a multiple of 14 days after it) — **compute** the current one, never eyeball it (see [guidelines.md](guidelines.md) §10 for the one-line formula). "Add to the current sprint" = apply the current sprint label. Never assign a Cycle. Unfinished issues roll over by **re-tagging** with the next sprint's label (manual).
2. **Use only these labels** (exact names, lowercase), as many as genuinely fit:
   - `business-req` — client / business-owner work (external, usually deadlined)
   - `engineering-goal` — committed dev work (features / planned tasks)
   - `ai-eval` — AI pipeline, eval prompts, scoring, AI interview, benchmarking, tuning
   - `backend` — Express APIs, services, Postgres, migrations, auth, AWS/pm2
   - `frontend` — React UI, components, state, styling
   - `security` — authn/authz, RBAC, XSS, secrets, CSP, tokens, IDOR (pair with backend/frontend)
   - `performance` — render cost, store subscriptions, caching/query efficiency, bundle size
   - `bug` — defect fix (broken behavior; not new work or cleanup); lowercase — migrate legacy `Bug`
   - `tech-debt` — refactors, cleanup, code-health (not a feature/bug)
   - `blocked` — waiting on a dependency/decision (remove when unblocked)
   - `docs` — documentation
   - `sprint/YYYY-MM-DD` — sprint commitment
   Full-stack issue = `backend` + `frontend`. Do NOT invent new issue labels (there's no `Refactor` — use `tech-debt`). Note: `feature` is a **project** label, not an issue label — its only job is to surface a **project** in the pm-dashboard Features column (see *Create a project*). Never apply `feature` to an issue.
3. **Status hygiene is strict.** Move an issue Todo → In Progress the moment you **pick it up**, and → Done the moment you **finish**. Never do the work and batch-jump it to Done — Linear's `startedAt`/`completedAt` timestamps must reflect reality.
4. **Dependencies = relation + label.** For a real dependency, set the issue's **blocked by** relation to the blocker (first-class Linear relation; cross-team is fine, e.g. blocked by AI Research's *Skill Map v1*) AND add the `blocked` label. For an incidental cross-effect, use a **related** link — do NOT merge projects.

## Structure
Workspace **Tangible Careers** → **Teams** (**Engineering**: Aaryash, Kaushal, Prabin — full 2-week Scrum; **AI Research**: lightweight backlog, no sprints) → **Projects** (work that ENDS) → **Issues** (the unit) → optional **sub-issues**. Roles (backend/frontend) are NOT separate teams — one Engineering team.

## Project vs not-a-project
Make a **project** only if you can picture saying "this is finished" and closing it. Forever-buckets ("Improvements", "Refactors") are NOT projects → use backlog issues + labels. Finish a project by setting it **Completed** (or **Cancelled**) — don't delete; close/cancel its issues first (closing a project doesn't close its issues).

## Issues
Every real, multi-day unit of work is an issue — **mandatory, tracked strictly**. Fields: clear title; description (context + acceptance criteria + links); assignee; status; priority (Urgent/High/Medium/Low); labels; project; sprint label if committed; relations; due date only if there's a real deadline. **Sub-issues are optional** — create them if they help you organize, skip them otherwise. Be strict with issues, relaxed with sub-issues.

## Workflows

### Create an issue
Title + description → set **team** (Engineering unless it's AI Research work), **project**, assignee, priority, labels (from the taxonomy). If it's committed to this sprint, add `sprint/YYYY-MM-DD`. If it depends on something, set blocked-by + `blocked`.

### Create a project
Apply the "can I call it done?" test first. Then: team → new project with a name, short summary, lead, and status; target date only if a real deadline exists.

To make a project appear in the pm-dashboard **Features** column, tag the **project** (not an issue) with the `feature` project label. The board matches it **case-insensitively** (`feature`/`Feature` both work). Project labels can only be created in Linear's UI, not via the API — if `feature` doesn't exist yet, ask someone to create it, then apply it with `save_project`.

### Commit work to a sprint
Compute the current sprint's Monday (anchor `2026-06-15` + 14-day multiples; see guidelines.md §10 for the formula — don't guess). Ensure a `sprint/YYYY-MM-DD` label exists (create it under the `sprint/` group if missing), then apply it to the committed issues. To roll over, re-tag unfinished issues with the new sprint label.

### Set a dependency
On the blocked issue: add the **blocked by → \<blocker\>** relation (search by name; cross-team OK) and the `blocked` label. Remove `blocked` when it clears.

### Gather someone's work ("what's on my plate" / onboarding dump)
When asked to collect an engineer's current work (e.g. before sprint planning, to send **Aaryash**), produce three buckets — **In progress**, **To do (committed)**, **Backlog (someday)** — with a title + one line of context per item. Keep it plain; these become proper issues together later. (If asked, then create them as issues per the rules above.)

## Quick reference — which thing do I create?
- Single task → **issue** (labeled, assigned, in a project)
- Task too big for one issue → issue + **sub-issues** (optional)
- Finishable body of related work → **project**
- Forever-bucket of small improvements → NOT a project → labeled backlog issues
- Commit to this sprint → add `sprint/YYYY-MM-DD`
- Hard dependency → **blocked by** relation + `blocked` label
- Incidental cross-effect → **related** link
- Big goal spanning several projects → **initiative** (rare; must be finishable — never a permanent category)

## Common mistakes
- ❌ Using Linear **Cycles** for sprints → ✅ `sprint/YYYY-MM-DD` labels.
- ❌ Inventing labels or applying `Feature`/`Refactor`/capitalized `Blocked` → ✅ only the taxonomy above; lowercase `blocked`.
- ❌ Doing the work, then jumping the issue straight to Done → ✅ move through In Progress as you go.
- ❌ Making a forever-bucket a project → ✅ backlog issues + labels.
- ❌ Relying on a "Blocked" status → ✅ the **blocked by** relation + `blocked` label.

When unclear on process, check [guidelines.md](guidelines.md) or ask **Aaryash** (running the Scrum move).
