---
description: Commit issues to the current sprint using the sprint/YYYY-MM-DD label (no Cycles)
argument-hint: [issues to commit / the sprint goal]
---
Invoke the `tangible-linear` skill and help plan/commit the current sprint, following
Tangible's conventions (sprints are date-labels, NOT Linear Cycles):

1. Compute the current sprint's **Monday** deterministically — sprint Mondays are anchored
   on `2026-06-15`, every sprint a multiple of 14 days after (never eyeball it):
   `python3 -c "import datetime as d; a=d.date(2026,6,15); t=d.date.today(); print('sprint/'+(a+d.timedelta(days=14*((t-a).days//14))).isoformat())"`.
   Ensure that `sprint/YYYY-MM-DD` label exists; if not, create it under the `sprint/` group (issue label).
2. Apply that sprint label to the issues being committed.
3. Confirm each committed issue has a clear owner, priority, status, and the right
   team/project + taxonomy labels.

Sprint scope / issues: $ARGUMENTS
