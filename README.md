# Tangible Plugins

Tangible Careers' **private** AI-agent plugin marketplace — company use only.

## Plugins

- **tangible-linear** — Tangible's Linear conventions for any agent (Claude Code, Codex,
  Cursor, opencode, Gemini, Antigravity, Pi). See [`plugins/tangible-linear/`](plugins/tangible-linear/).

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
