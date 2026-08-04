---
description: Lint Linear issues against Tangible's conventions (taxonomy, labels, status, dependencies) and report violations
argument-hint: [issue IDs / a filter / "my open issues"]
---
Invoke the `tangible-linear` skill and read `workspace.json`, then **audit** the issue(s)
below against Tangible's conventions. This is a **read-only report** — do NOT change
anything unless the user asks.

Check each issue against these rules:

1. **Labels** — has ≥1 **area** label (`backend`/`frontend`/`ai-eval`/`security`/`performance`)
   and, where it applies, a **type** label (`engineering-goal`/`business-req`/`bug`/`tech-debt`/`docs`).
   All lowercase, all from the taxonomy. Flag any invented or legacy labels (`Bug`, `Feature`,
   `Improvement`, capitalized variants).
2. **Project** — assigned to a project (or a deliberate standalone backlog issue).
3. **Assignee** — has an owner.
4. **Status sanity** — not sitting in Todo while clearly being worked; if Done, `startedAt`/
   `completedAt` look real (not batch-jumped).
5. **Sprint** — if committed to the current sprint, carries the correct `sprint/YYYY-MM-DD`
   label. **Compute** the current sprint (anchor `2026-06-15` + 14-day multiples) — don't guess.
6. **Dependencies** — if it has the `blocked` label it must also have a `blocked by` relation
   (and vice-versa). Incidental cross-effects should use `related`, not `blocked`.
7. **`feature` misuse** — `feature` is a **project** label; flag it if applied to an issue.

**Output:** a table of `issue → ✅/❌ per rule` plus a one-line fix for each ❌. Then offer to
apply the fixes (which would run the normal `tangible-linear` write flow).

Scope: $ARGUMENTS
