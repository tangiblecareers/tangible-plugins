# tangible-linear

A **universal AI-agent plugin** that teaches any agent Tangible Careers' Linear
conventions — issues, projects, **sprint date-labels** (not Cycles), the label
taxonomy, strict status hygiene, and blocked-by/related dependencies — so work gets
created and tracked the team's way. Works with **Claude Code, Codex, Copilot, Cursor,
opencode, Gemini CLI, Antigravity CLI, and Pi**.

The plugin ships the `tangible-linear` **skill** (the how-to layer). The actual Linear
tools come from **Linear's own MCP** — connect that in your agent, and this plugin makes
the agent use it correctly.

## Install

### Fastest — universal installer (Codex · Copilot · Claude Code · Antigravity · Gemini · Pi)
Clone, then run the installer once. It symlinks the skill into each agent's global skills
dir (so `git pull` keeps everything current):
```bash
git clone https://github.com/tangiblecareers/tangible-plugins
node tangible-linear-plugin/bin/install.mjs
```
It targets: `~/.agents/skills` (Codex/Copilot), `~/.claude/skills` + `~/.claude/commands`
(Claude Code), `~/.gemini/config/skills` (Antigravity/Gemini), and `~/.pi/agent/skills` (Pi).

### Claude Code (plugin marketplace)
```
/plugin marketplace add tangiblecareers/tangible-plugins
/plugin install tangible-linear@tangible
```
Installs at user scope → active in **all** your repos.

### Cursor
Point Cursor at this repo's plugin (`.cursor-plugin/plugin.json`) per Cursor's plugin
settings, or just run the universal installer above.

### opencode
opencode reads `AGENTS.md` for instructions; the universal installer also places the
skill where opencode-compatible tooling finds it.

### Gemini CLI
```
gemini extensions install https://github.com/tangiblecareers/tangible-plugins
```
(uses `gemini-extension.json` → `GEMINI.md`).

### Antigravity CLI
The universal installer places the skill in `~/.gemini/config/skills/` (Antigravity's global
skills dir). Per-repo instead: symlink `skills/tangible-linear` into `<repo>/.agents/skills/`.
Antigravity surfaces it and loads `SKILL.md` when it applies.

### Pi
The universal installer places the skill in `~/.pi/agent/skills/`. Pi also discovers it via
the package's `pi.skills` entry (`package.json`) and any `<repo>/.agents/skills/`.

## What you get

- **Skill `tangible-linear`** — auto-applies whenever you create/update/organize Linear work.
- **Skill `linear-organize`** — audits/structures the workspace into the initiative hierarchy.
- **Claude Code commands:** `/linear`, `/linear-dump`, `/sprint-plan`, `/linear-organize`,
  `/linear-lint`, `/linear-onboard`.
- **`workspace.json`** — the seeded source of truth (teams, people, taxonomy, sprint anchor,
  live initiatives) that the skills read before acting.
- New here? See [`ONBOARDING.md`](ONBOARDING.md).
- Full reference in `skills/tangible-linear/guidelines.md`.

## Prerequisite

Connect **Linear's MCP** in your agent (the official Linear remote MCP, or your setup's
equivalent). This plugin is the conventions layer on top of those tools.

## Scope

This distributes the **conventions** (a skill/instructions). It is not an MCP server and
does not itself perform Linear writes — your agent does that through Linear's MCP. See
`skills/tangible-linear/SKILL.md` for the rules.
