# Tangible Careers — Linear Guidelines

> **Read this before you start using Linear.** It explains every term, how our
> workspace is structured, and how to create and track work. This is our team
> standard — follow it so everyone's work stays legible to each other (and to any
> AI agents we point at the board).
>
> Questions or anything unclear → ask **Aaryash** (running our move to Scrum).

---

## 1. Why we use Linear

We're moving from ad-hoc, client-driven work ("let's talk daily and figure out what's
next") to a **structured 2-week sprint** process. Linear is our single source of truth
for *what we're working on, who owns it, and where it stands.* If work isn't in Linear,
as far as the team is concerned it isn't happening.

---

## 2. What we need from you right now

Before your first sprint planning, send Aaryash **everything on your plate**, in three buckets:

1. **In progress** — what you're actively working on right now
2. **To do (committed)** — things you know you need to do soon
3. **Backlog (someday)** — should be tracked, but not urgent

A title + one line of context per item is plenty. Don't worry about labels or
formatting — we'll turn these into proper issues together.

---

## 3. Terminology — learn these first

| Term | What it means |
|------|---------------|
| **Workspace** | The whole organization in Linear. Ours is **Tangible Careers**. Everything lives inside it. |
| **Team** | A group with its own backlog and settings. We have **Engineering** and **AI Research**. |
| **Project** | A cohesive body of work that has an **end** — something you can eventually call "done." |
| **Issue** | A single unit of work — the actual task you do. The core thing you'll interact with. |
| **Sub-issue** | A smaller task *inside* an issue. Optional (see §8). |
| **Label** | A tag that categorizes an issue (e.g. `backend`, `bug`) regardless of project. |
| **Initiative** | A high-level, time-bound **goal** that groups several projects. Used sparingly. |
| **Sprint** | A fixed 2-week chunk of work we commit to. We track sprints with **date labels** (see §10). |
| **Status** | Where an issue stands: Backlog → Todo → In Progress → Done (or Cancelled). |
| **Priority** | Urgent / High / Medium / Low. |
| **Blocked by / Related** | Relationships between issues (see §11). |
| **Backlog** | The pool of issues not yet committed to a sprint. |

---

## 4. The structure (top to bottom)

```
Workspace            → Tangible Careers
  └── Teams          → Engineering · AI Research
        └── Projects → e.g. "Clean up Evaluator's View" (has an end)
              └── Issues       → the actual tasks
                    └── Sub-issues → optional smaller pieces
```

Cutting **across** all of it:
- **Labels** — categorize issues (including which sprint they're in)
- **Initiatives** — group related projects under a shared goal

---

## 5. Teams

A team has its own backlog and settings. We have two:

### Engineering
- **Members:** Aaryash, Kaushal, Prabin
- Builds and maintains the platform — backend, frontend, AI evaluation
- Runs full Scrum: 2-week sprints, planning, rotating scrum master

### AI Research
- Researches the skill maps and performance-graph models behind the platform
- Works independently on a **lightweight backlog** — no strict sprints
- Engineering depends on its deliverables (e.g. Skill Map v1)

### Business/Company & Tangible Founder
Two more teams exist in the workspace: **Business/Company** (client/company projects) and
**Tangible Founder** (founder-led programs & workshops — EU UDAAN, YI Lab, AI for
Entrepreneurs). Neither runs Engineering's sprint cadence. See `workspace.json` → `teams`.

**Rule of thumb:** different *roles* (backend vs frontend) do **not** mean different
teams — we're one Engineering team. Teams split only when the work rhythm is genuinely
different, which is why AI Research is separate.

---

## 6. Projects

A **project** is a chunk of related work **that ends.**

**The test:** *Can I picture saying "this is finished" and closing it?*
- **Yes** → it's a project.
- **No** (it's a forever-bucket like "Improvements" or "Refactors") → **don't** make
  it a project. Use the backlog + labels instead.

Our current active projects (Engineering):
- Legacy Decommission — Program/Module, Role Surface, Menternship
- Clean up Evaluator's View
- Clean up Learner's View
- Update Educator's View *(blocked by Skill Map v1)*
- Scrum Migration

And **Skill Map v1** under AI Research.

**How to create a project:** In a team → **Projects → + New project**. Give it a name,
a short summary, a lead, and a status. Add a target date only if there's a real deadline.

**Keeping the projects page clean:** Don't delete finished projects. Set them to
**Completed** (or **Cancelled** if abandoned) — they drop out of the active view
automatically and history is preserved. Note: closing a project does **not** auto-close
its issues, so wrap up or cancel the issues first to avoid orphans.

**Overlap is normal.** Projects often share code (e.g. cleaning the educator view may
touch shared learner components). That's *incidental overlap*, not a reason to merge
projects. Keep them separate, ship them independently, and link the cross-effects with
a **related** issue link (§11). Use an **initiative** (§9) to express that they belong
to the same bigger effort.

---

## 7. Issues — the core unit

An **issue** is one multi-day unit of work. Every issue has:

- **Title** — short and clear ("Update evaluator APIs to remove programs & modules")
- **Description** — context, acceptance criteria, links
- **Assignee** — who owns it
- **Status** — Backlog → Todo → In Progress → Done (keep this current — §12)
- **Priority** — Urgent / High / Medium / Low
- **Labels** — see §9
- **Project** — which project it belongs to
- **Sprint label** — if it's committed to the current sprint (§10)
- **Relations** — blocked by / related (§11)
- **Due date** — only if there's a real deadline

**How to create an issue:** Press `C` anywhere, or click **+ New issue**. Fill in title
+ description, set the project, assignee, labels, and priority.

**Example of a good issue:**
> **Title:** Update evaluator APIs to remove programs & modules
> **Labels:** `backend`, `engineering-goal`
> **Description:** Identify evaluator endpoints returning programs/modules; remove those
> fields; update response contracts. Presentation change only — do NOT drop tables.
> Coordinate the response shape with the frontend issue.

---

## 8. Sub-issues — optional, your call

This is a hard rule worth being explicit about:

- **Issues are mandatory and tracked strictly.** Anything that's real, multi-day work
  **must** be an issue with a live status. No exceptions. This is how the team and our
  planning stay honest about what's happening.
- **Sub-issues are optional, at your discretion.** They're the minor steps *inside* an
  issue — the small tasks you do to get it done. Tracking them is **good but not
  required.** Create them if they help you organize; skip them if it's just
  micro-managing yourself.

We are **not** tracking every keystroke. If you like keeping sub-issues updated, great —
you can even point an agent (e.g. Claude Code) at maintaining them. The line is simple:
**be strict with issues, relaxed with sub-issues.**

**Example sub-issues** (under the issue above, all optional):
> • Audit evaluator endpoints returning programs/modules
> • Strip the fields from the serializers
> • Update response contract/types
> • Add a regression test

---

## 9. Labels

Labels categorize issues across all projects. Apply as many as genuinely fit.

| Label | Use it for |
|-------|-----------|
| `business-req` | Work from a client/business owner — external requirements, deliverables, usually with a deadline. Not internal tech tasks. |
| `engineering-goal` | Committed dev work — features and planned engineering tasks. |
| `ai-eval` | AI evaluation work — the AI pipeline, eval prompts, scoring, AI interview, benchmarking, model tuning. |
| `backend` | Server-side — Express APIs, services, Postgres, migrations, auth, AWS/pm2. |
| `frontend` | Client-side — React UI, components, state, styling. |
| `security` | Security / access-control — authn/authz, RBAC, XSS, secrets, CSP, token handling, IDOR. Pair with `backend`/`frontend`. |
| `performance` | Performance — render/re-render cost, store subscriptions, caching/query efficiency, bundle size. Pair with `backend`/`frontend`. |
| `bug` | Defect fix — a broken behavior, not new work (`engineering-goal`) or cleanup (`tech-debt`). Lowercase; migrate the legacy capitalized `Bug`. |
| `tech-debt` | Refactors, cleanup, code-health work that isn't a feature or bug. |
| `blocked` | Issue is waiting on a dependency, another team, or a decision. Remove once unblocked. |
| `docs` | Documentation — API docs, knowledge-base entries, README/CLAUDE.md updates. |
| `sprint/YYYY-MM-DD` | Marks which sprint an issue is committed to (§10). |

**Combining is normal:** full-stack issue = `backend` + `frontend`; a client feature gets
`business-req` on the parent issue and `engineering-goal` on the implementation issues.

**How to create a label:** Settings → Team/Workspace → Labels → *New label*. Give it a
clear name, colour, and a one-line "when to use it" description.

---

## 10. Sprints (we track these with date labels)

> Our plan doesn't include Linear's built-in **Cycles**, so we run sprints **manually
> using labels.** The cadence and ceremonies are identical — only the mechanism differs.

**The convention:** each sprint gets a label named after its **first day (Monday)**, in
ISO date format, under a `sprint/` group:

```
sprint/2026-06-15      ← sprint starting Mon June 15
sprint/2026-06-29      ← next sprint
```

Why this format:
- **Self-documenting** — the label tells you when the sprint ran, no lookup needed
- **Sorts chronologically** on its own (ISO dates sort alphabetically)
- **Groups together** under the `sprint/` prefix, away from `backend`, `bug`, etc.

**The anchor (so the current sprint is computable, not guessed):** sprint Mondays are
anchored on **`2026-06-15`**. Every sprint starts on a Monday that is an exact multiple
of **14 days** after the anchor. To get the current sprint label deterministically:

```bash
python3 -c "import datetime as d; a=d.date(2026,6,15); t=d.date.today(); print('sprint/'+(a+d.timedelta(days=14*((t-a).days//14))).isoformat())"
```

(e.g. on 2026-07-23 this prints `sprint/2026-07-13`; the following sprint is
`sprint/2026-07-27`.) **Never eyeball which Monday it is — compute it.** If the team
re-anchors the cadence, update this date here (and in `workspace.json`).

**How a sprint runs:**
1. At **sprint planning**, tag the issues you're committing to with the current
   sprint label (e.g. `sprint/2026-06-15`).
2. Work the board: move issues Todo → In Progress → Done as you go (§12).
3. A saved **View** filtered to the current sprint label = your sprint board.
4. At the next planning, **re-tag** any unfinished issues with the new sprint label
   (no auto-rollover without Cycles — this is manual).

**Cadence:** 2 weeks, Monday start, one sprint at a time, **rotating scrum master**
(Aaryash runs the first). The 2-week rhythm is a team agreement, not tool-enforced.

**Note:** without Cycles we don't get automatic velocity/burndown charts. We rely on
issue status + timestamps (§12) to see progress. If we upgrade the plan later, we can
switch to native Cycles.

---

## 11. Relationships: blocked-by vs related

- **Blocked by** — issue B can't start until issue A is done. Open B → relations →
  **blocked by → A**. Linear flags B as blocked until A finishes. Use for real
  dependencies, including cross-team (e.g. *Update Educator's View* is blocked by
  *Skill Map v1* from AI Research). Add the `blocked` label too so it surfaces.
- **Related** — the issues touch each other but neither strictly blocks the other (e.g.
  shared components between learner and educator views). Use this instead of merging
  projects.

---

## 12. Keep your status current (why it matters)

Linear automatically timestamps when an issue becomes **In Progress** and when it
becomes **Done** (stored as `startedAt` / `completedAt`, visible in each issue's activity
log). The same applies to projects.

**But that data is only accurate if you actually move issues through the statuses.** If
you do the work but leave an issue in "Todo" until it's all finished and then jump it to
"Done," the timing data is meaningless and nobody can see real progress.

So: **update your issue status as you work** — pick it up → In Progress; finish it →
Done. This keeps the board trustworthy and is part of our strict-issue-tracking rule.

---

## 13. Initiatives — use sparingly

An **initiative** is the highest level: a **time-bound goal** that several projects roll
up into (e.g. *Platform Cleanup & Simplification*, grouping the three view-cleanup
projects + legacy decommission).

**Important:** initiatives are for goals that **end**, not permanent categories. Don't
create an initiative called "Engineering Goals" — it never finishes and the progress bar
becomes meaningless. Use **labels** for permanent categories; use **initiatives** only
for real, finishable goals. As a small team we use them rarely. The current set of
workspace initiatives (all finishable) is catalogued in the `linear-organize` skill.

**How to create one:** Initiatives in the sidebar → *New initiative*, then attach the
relevant projects. (May require a paid plan.)

---

## 14. Quick reference — which thing do I create?

- A single task → **Issue** (label it, assign it, set a project)
- A task too big for one issue → **Issue + Sub-issues**
- A finishable chunk of related work → **Project**
- A forever-bucket of small improvements → **NOT a project** — labelled backlog issues
- A big goal spanning several projects → **Initiative** (rarely)
- Committing work to this sprint → add the `sprint/YYYY-MM-DD` label
- A hard dependency → set **blocked by** on the issue + add the `blocked` label
- An incidental cross-effect → **related** link (don't merge projects)

---

## 15. Our cadence

- **Sprint length:** 2 weeks, Monday start
- **Sprint planning:** start of each sprint — pick issues, tag them with the sprint
  label, set the goal, assign owners
- **Daily check-in:** quick async status (internal)
- **Client sync:** weekly, at sprint start, to confirm priorities
- **Scrum master:** rotates each sprint (Aaryash first)
- **Definition of done:** to be finalized as a team during Sprint 1 (e.g. merged,
  tested, issue moved to Done)

---

*This doc will evolve as we settle into the process. Flag anything unclear to Aaryash.*
