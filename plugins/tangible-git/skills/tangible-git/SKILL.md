---
name: tangible-git
description: Use when creating branches, commits, or pull requests in a Tangible Careers repo — applies the team's branch naming, conventional-commit, PR-structure, and Linear-linking conventions.
---

# Tangible Careers — Git & PR conventions

> ⚠️ **Scaffold — conventions not yet finalized.** This skill's structure is in place;
> the rules below are placeholders to be filled in with the team. Do not treat the TODOs
> as authoritative yet.

Apply these whenever you branch, commit, or open a PR for a Tangible Careers repo.

## Branch naming — TODO
_e.g._ `type/short-slug` (`feat/…`, `fix/…`, `chore/…`) — confirm with the team.

## Commits — TODO
Conventional Commits (`type(scope): summary`). Define the allowed `type`s and `scope`s,
and whether commits must reference a Linear issue.

## Pull requests — TODO
- PR title/description template
- Required reviewers / review checklist (see the `tangible-review` plugin)
- Linking the PR to its Linear issue (and moving the issue to In Progress / Done —
  see the `tangible-linear` plugin's status-hygiene rule)

## Cross-plugin
- Issue tracking & status hygiene → `tangible-linear`
- Review rubric → `tangible-review`
