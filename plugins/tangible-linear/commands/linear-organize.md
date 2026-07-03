---
description: Audit the Tangible Careers Linear workspace and map everything into the initiative → project → milestone → issue hierarchy, then show what needs to be created or linked
argument-hint: [optional: "execute" to run the migration after auditing]
---
Invoke the `linear-organize` skill and run the full workspace audit for **Tangible Careers**.

Steps:
1. Run the inventory (list_initiatives, list_projects, list_documents, list_issues for ENG/BIZ/AIR, list_milestones)
2. Map every item to its correct hierarchy level using the initiative table in the skill
3. Produce the gap analysis table (what needs to be created / linked / fixed)
4. Build the visual HTML artifact showing the full tree (color-coded: blue=create, amber=link, green=exists, rose=missing/blocked, cyan=doc, purple=milestone)

If the argument is "execute", also run the 7-step migration from the skill (create initiatives → link projects → add milestones → set relations → apply labels → post status updates → archive legacy labels). Confirm before each destructive-adjacent step.

Scope / mode: $ARGUMENTS
