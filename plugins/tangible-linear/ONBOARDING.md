# Onboarding — Tangible Careers Linear (for new engineers)

Welcome. We run our work through **Linear**, and we point AI agents at it too. This is the
5-minute version; the full standard is in [`skills/tangible-linear/guidelines.md`](skills/tangible-linear/guidelines.md).

> In Claude Code you can just run **`/linear-onboard`** and it will walk you through all of
> this interactively.

## 1. Connect the Linear MCP

Everything here runs on top of **Linear's own MCP**. Connect it in your agent first (the
official Linear remote MCP, or your setup's equivalent). Without it, the plugin has nothing
to act through. Verify with a quick "list my Linear teams".

## 2. Install the conventions plugin

- **Claude Code:** `/plugin marketplace add tangiblecareers/tangible-plugins` then
  `/plugin install tangible-linear@tangible`.
- **Any agent:** clone the repo and run `node plugins/tangible-linear/bin/install.mjs`.

See the [README](README.md) for per-agent detail.

## 3. The rules that actually matter

- **Sprints are `sprint/YYYY-MM-DD` labels**, not Linear Cycles. The date is the sprint's
  **Monday**, computed from the anchor `2026-06-15` + 14-day multiples — the tools compute
  it, you don't guess.
- **Use only the label taxonomy** (lowercase): `business-req`, `engineering-goal`, `ai-eval`,
  `backend`, `frontend`, `security`, `performance`, `bug`, `tech-debt`, `blocked`, `docs`,
  `sprint/YYYY-MM-DD`. Don't invent labels. (`feature` is a **project** label, never on an issue.)
- **Status hygiene is strict:** move an issue Todo → In Progress the moment you pick it up,
  → Done the moment you finish. Never batch.
- **Dependencies:** real blocker → `blocked by` relation **+** `blocked` label; incidental
  cross-effect → a `related` link.
- **Projects must be able to END.** Forever-buckets are labeled backlog issues, not projects.

The seeded workspace facts (teams, people, initiatives, taxonomy) live in
[`workspace.json`](workspace.json); agents read it, then confirm against live Linear.

## 4. Your first task — the work dump

Before your first sprint planning, send **Aaryash** everything on your plate in three buckets:

1. **In progress** — what you're actively working on now
2. **To do (committed)** — things you know you need to do soon
3. **Backlog (someday)** — should be tracked, not urgent

A title + one line of context per item is plenty. In Claude Code: **`/linear-dump`**. We'll
turn these into proper issues together.

## Handy commands (Claude Code)

| Command | What it does |
|---|---|
| `/linear <request>` | Do a Linear task under the conventions |
| `/linear-dump [who]` | The 3-bucket work dump for planning |
| `/sprint-plan <issues>` | Commit issues to the current sprint |
| `/linear-organize [execute]` | Audit/structure the workspace into the initiative hierarchy |
| `/linear-lint <issues>` | Check issues against the conventions and report violations |
| `/linear-onboard [name]` | This onboarding flow, interactively |

Questions about process → **Aaryash** (running our move to Scrum).
