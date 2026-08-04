---
name: linear-organize
description: Use when auditing the Tangible Careers Linear workspace structure, mapping all projects/documents/issues into the initiative → project → milestone → issue hierarchy, or executing the additive workspace migration.
---

# Linear Workspace Organization

Audit and structure the **Tangible Careers** Linear workspace into Linear's full
hierarchy. All operations are **additive** — nothing is deleted, moved, or renamed.

**Start by reading [`workspace.json`](../../workspace.json)** for the seeded teams,
taxonomy, and initiative list — then **always `list_initiatives` / `list_projects` live**,
because the workspace changes and the seed goes stale.

## The hierarchy

```
Workspace
└── Initiative  (big finishable goal spanning several projects)
    └── Project  (finishable body of work)
        ├── Milestone  (checkpoint inside a project)
        ├── Document   (living doc attached to the project)
        ├── Status Update  (post one per In Progress project weekly)
        └── Issue  (the unit of work)
            ├── Sub-issue  (optional breakdown)
            └── Relation   (blocked-by / related)
```

**Standalone** — two projects intentionally live at workspace level with NO
initiative: `Business Requests` (forever bucket) and `Tangible Descriptions` (doc
project). Leave them unlinked.

## Initiative rules

An initiative is a **big, finishable goal** that spans several projects — not a
permanent category. Apply the same "can I call it done?" test as for projects. Never
create a forever-bucket initiative. This is the **same rule** as the `tangible-linear`
guidelines (§13): initiatives are used sparingly and must be able to END.

**Do not hard-code the initiative list** — read [`workspace.json`](../../workspace.json)
(`initiatives.live`) and **always `list_initiatives` live** before acting. As of the
2026-07-23 seed the live initiatives were:

| Initiative | Theme |
|---|---|
| Agents-First Platform | Machine-legible API contract + tooling so agents can drive platform flows |
| LMS Enhancement | Richer course content + cleaner learner/educator/evaluator experiences |
| Code Health & Tech-Debt Control | Tests, validations, transactions, error handling, legacy cleanup |
| Usability & Quality of Life | UX polish and friction-reducing improvements, feedback-driven |
| Public Courses & Certification | Public course sharing + certificate enhancements (business req) |
| Course Builder POC | Throwaway POC: prompt-driven course creation on a Neo4j skill graph |
| Workshop | Founder workshops (confirm whether finishable) |

> ⚠️ Earlier versions of this skill hard-coded invented initiatives (Platform Foundations,
> Educator Experience Rebuild, Agentic Development Layer, AI Research & Skill Intelligence,
> Programs & Partnerships, Core Platform) that do **not** exist in the workspace. Never
> recreate them — reconcile against the live list.

## Audit workflow

Run these in order. Use the Linear MCP tools.

### 1. Inventory

```
list_initiatives        → see what already exists
list_projects           → all projects (43 on the 2026-07-23 seed), note status + team
list_documents          → all docs, note which project they belong to
list_issues (ENG)       → active + backlog issues
list_issues (BIZ)       → business issues
list_issues (AIR)       → research issues
list_milestones         → per project (if any exist)
```

### 2. Map to hierarchy

For each project, determine:
- **Which initiative** does it belong to? (Use the table above.)
- **Status** — In Progress, Planned, Backlog, Completed?
- **Milestones needed?** — Only for In Progress projects with phased delivery.
- **Relations missing?** — Any blocked-by dependencies not yet set?
- **Status update?** — Every In Progress project should have a recent update.

### 3. Gap analysis output

Produce a table with four action columns:

| Item | Type | Action | Reason |
|---|---|---|---|
| Platform Foundations | Initiative | Create | Does not exist yet |
| Error Handling & Transactions | Project | Link to Platform Foundations | Not linked to any initiative |
| ENG-111 | Issue | Label | Missing `backend` label |
| Educator's View | Project | Set `blocked by` → Skill Map v1 | Dependency not recorded |

## Migration — execution order

Always execute in this order (each step is safe to re-run):

1. **Create initiatives** — `save_initiative` for each one that doesn't exist
2. **Link projects to initiatives** — `save_project` with `initiativeId` field
3. **Add milestones** — `save_milestone` on In Progress projects with phased delivery
4. **Set missing relations** — `save_issue` with `blockedByIds` for real dependencies; add `blocked` label
5. **Apply missing labels** — `save_issue` for issues with no taxonomy labels
6. **Post status updates** — `save_status_update` on all In Progress projects (one per project)
7. **Archive legacy labels** — only after confirming no active issues use them

Never: delete projects, close issues, rename things, or merge teams.

## Visual output (Artifact)

After auditing, build an HTML artifact showing the full tree:

- **Color coding**: blue = create new · amber = link existing · green = done/exists · rose = missing/blocked · cyan = document · purple = milestone
- **Structure**: collapsible `<details>` per initiative, indented tree with connector lines, status badges, action tags
- **Legend** at top, count summary bar (initiatives / projects / milestones / issues needing labels)
- **Standalone** section at the bottom for Business Requests and Tangible Descriptions

## Common mistakes

- ❌ Deleting or moving a project → ✅ additive only; just add the initiative link
- ❌ Creating an initiative for a permanent category ("Engineering Work") → ✅ initiatives must be finishable
- ❌ Linking Business Requests or Tangible Descriptions to an initiative → ✅ these are standalone by design
- ❌ Creating milestones for Completed projects → ✅ milestones only on active In Progress projects
- ❌ Posting a status update without checking if one exists → ✅ check `get_status_updates` first
