---
description: Onboard a new engineer to Tangible's Linear — verify the MCP connection, teach the conventions, and produce their first 3-bucket work dump
argument-hint: [engineer name, optional]
---
Invoke the `tangible-linear` skill and read `workspace.json` + `ONBOARDING.md`, then walk a
new engineer through getting set up on Tangible's Linear:

1. **Check the connection** — confirm the Linear MCP is connected (try `list_teams`). If it
   isn't, point them to connect it (README → *Prerequisite*) and stop here.
2. **Orient** — summarize the essentials from the skill in a few lines: sprints are
   `sprint/YYYY-MM-DD` **labels** (not Cycles), the label taxonomy, strict status hygiene
   (Todo → In Progress on pickup → Done when finished), `blocked by` + `blocked`, and the
   project "can I call it done?" test. Point to `guidelines.md` for depth.
3. **Show their workspace** — list their team(s), the active projects, and the **current
   sprint label** (compute it — anchor `2026-06-15` + 14-day multiples).
4. **First task — the work dump** — run the `/linear-dump` 3-bucket flow (In progress /
   To do (committed) / Backlog) for this person, ready to send to **Aaryash** before sprint
   planning. Then offer to turn the buckets into properly-labeled issues per the conventions.

Engineer: $ARGUMENTS
