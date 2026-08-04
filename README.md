# Tangible Plugins

Tangible Careers' **private** AI-agent plugin marketplace — company use only.

## Plugins

- **tangible-linear** — Tangible's Linear conventions for any agent (Claude Code, Codex,
  Cursor, opencode, Gemini, Antigravity, Pi). See [`plugins/tangible-linear/`](plugins/tangible-linear/).
- **tangible-pbl** — an MCP server that authors Problem-Based Learning courses in Tangible
  from a single brief, stopping at six human approval gates. Claude Code only — it ships a
  server rather than skills. See [`plugins/tangible-pbl/`](plugins/tangible-pbl/).

## Install a plugin

### Claude Code (marketplace)
```
/plugin marketplace add tangiblecareers/tangible-plugins
/plugin install tangible-linear@tangible
/plugin install tangible-pbl@tangible
```
Installs at user scope → active in all your repos.

### Any agent (universal installer)
```
git clone git@github.com:tangiblecareers/tangible-plugins.git
node tangible-plugins/plugins/tangible-linear/bin/install.mjs
```
Symlinks the skill into the skill dirs of Claude Code, Codex, Copilot, Antigravity/Gemini,
and Pi (so `git pull` keeps everyone current). This path is for the skill-based plugins;
`tangible-pbl` is an MCP server and installs through the marketplace only.

## Prerequisites

- **tangible-linear** — connect **Linear's MCP** in your agent. The plugin is the
  conventions layer on top of those tools.
- **tangible-pbl** — export your own Tangible credentials in your shell before starting
  Claude Code. The plugin ships the variable *names*, never values; see
  [`plugins/tangible-pbl/README.md`](plugins/tangible-pbl/README.md). The account needs
  `ADMIN` or `MANAGER` on the business being authored into.

## Access

Private to the `tangiblecareers` org. Not for external distribution.
