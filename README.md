# Tangible Plugins

Tangible Careers' **private** AI-agent plugin marketplace — company use only.

## Plugins

- **tangible-linear** — Tangible's Linear conventions for any agent (Claude Code, Codex,
  Cursor, opencode, Gemini, Antigravity, Pi). See [`plugins/tangible-linear/`](plugins/tangible-linear/).
- **tangible-git** *(scaffold)* — git & pull-request conventions (branch naming, conventional
  commits, PR structure, Linear linking). See [`plugins/tangible-git/`](plugins/tangible-git/).
- **tangible-api** *(scaffold)* — agent-legible API conventions (OpenAPI, typed clients,
  endpoint design) for the Agents-First Platform. See [`plugins/tangible-api/`](plugins/tangible-api/).
- **tangible-review** *(scaffold)* — code-review standards (correctness, security, performance,
  tests). See [`plugins/tangible-review/`](plugins/tangible-review/).

## Install a plugin

### Claude Code (marketplace)
```
/plugin marketplace add tangiblecareers/tangible-plugins
/plugin install tangible-linear@tangible
```
Installs at user scope → active in all your repos.

### Any agent (universal installer)
```
git clone git@github.com:tangiblecareers/tangible-plugins.git
node tangible-plugins/plugins/tangible-linear/bin/install.mjs
```
Symlinks the skill into the skill dirs of Claude Code, Codex, Copilot, Antigravity/Gemini,
and Pi (so `git pull` keeps everyone current).

## Prerequisite

Connect **Linear's MCP** in your agent — the plugins are the conventions layer on top of
those tools.

## Access

Private to the `tangiblecareers` org. Not for external distribution.
