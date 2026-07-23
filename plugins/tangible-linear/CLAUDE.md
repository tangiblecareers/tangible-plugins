# Tangible Linear

Apply **Tangible Careers'** Linear conventions whenever you create, update, or organize
work in Linear (via the Linear MCP). Full rules: `skills/tangible-linear/SKILL.md` and
`skills/tangible-linear/guidelines.md`. The `tangible-linear` skill auto-applies on Linear work.

## Slash commands (Claude Code)

- `/linear <request>` — do a Linear task under the conventions
- `/linear-dump [who]` — gather current work into In progress / To do / Backlog for planning
- `/sprint-plan <issues>` — commit issues to the current sprint via the `sprint/YYYY-MM-DD` label
- `/linear-organize [execute]` — audit/structure the workspace into the initiative hierarchy
- `/linear-lint <issues>` — check issues against the conventions and report violations
- `/linear-onboard [name]` — onboard a new engineer (verify MCP, teach rules, run the work dump)

## Rules that matter

- **Sprints are `sprint/YYYY-MM-DD` LABELS** (the sprint's Monday, ISO) — **NOT** Cycles.
- **Label taxonomy only** (lowercase): `business-req`, `engineering-goal`, `ai-eval`,
  `backend`, `frontend`, `security`, `performance`, `bug`, `tech-debt`, `blocked`, `docs`,
  `sprint/YYYY-MM-DD`. Don't invent labels. See `workspace.json` for the seeded taxonomy.
- **Status hygiene:** Todo → In Progress on pickup, → Done when finished; never batch.
- **Dependencies:** `blocked by` relation **+** `blocked` label; incidental → `related` link.
- **Project** only if it can END; forever-buckets are labeled backlog issues.

Teams: **Engineering** (`ENG`) · **AI Research** (`AIR`) · **Business/Company** (`BIZ`) · **Tangible Founder** (programs/workshops). Questions → **Aaryash**.
