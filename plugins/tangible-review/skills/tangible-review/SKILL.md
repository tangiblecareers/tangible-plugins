---
name: tangible-review
description: Use when reviewing a diff, PR, or change in a Tangible Careers repo — applies the team's shared review rubric (correctness, security, performance, test coverage) and reporting format.
---

# Tangible Careers — Code review standards

> ⚠️ **Scaffold — rubric not yet finalized.** Structure is in place; the dimensions below
> are placeholders to fill in with the team.

Apply this rubric whenever you review a change for a Tangible Careers repo.

## Dimensions — TODO
- **Correctness** — logic, edge cases, error handling, transactions.
- **Security** — authn/authz, input validation, secrets, injection (maps to the `security` label).
- **Performance** — queries, re-renders, caching, bundle size (maps to the `performance` label).
- **Tests** — coverage of the change, regression tests, meaningful assertions.
- **Conventions** — matches `tangible-git` (commits/PR) and `tangible-api` (endpoints).

## Reporting — TODO
Severity levels, how findings are grouped, and what blocks a merge vs. is a nit.

## Cross-plugin
- Findings can become `tangible-linear` issues (`bug`, `tech-debt`, `security`, `performance`).
- PR/commit conventions → `tangible-git`.
