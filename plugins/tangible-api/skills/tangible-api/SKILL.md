---
name: tangible-api
description: Use when designing, changing, or documenting Tangible Careers' HTTP APIs — applies the conventions that keep endpoints machine-legible and agent-operable (OpenAPI contracts, typed clients, consistent response shapes).
---

# Tangible Careers — Agent-legible API conventions

> ⚠️ **Scaffold — conventions not yet finalized.** Structure is in place; the rules below
> are placeholders to fill in with the team. This directly serves the **Agents-First
> Platform** Linear initiative.

Apply these whenever you add or change an API endpoint in a Tangible Careers backend.

## OpenAPI contract — TODO
Every endpoint documented in the OpenAPI spec; spec is the source of truth; generated,
not hand-drifted.

## Response shapes — TODO
Consistent envelope, error format, pagination, and field naming so an agent can predict
the shape without reading server code.

## Typed client — TODO
Generate a typed client from the spec; consumers (incl. agents) use it rather than raw
fetch.

## Endpoint design — TODO
Resource naming, verbs/status codes, idempotency, and how endpoints expose enough
metadata to be driven by an agent.

## Cross-plugin
- Backend work is tracked under `tangible-linear` (`backend`, `engineering-goal` labels).
