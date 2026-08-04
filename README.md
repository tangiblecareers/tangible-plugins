# Tangible Plugins

Tangible Careers' **private** AI-agent plugin marketplace — company use only.

## Plugins

- **tangible-linear** — Tangible's Linear conventions for any agent (Claude Code, Codex,
  Cursor, opencode, Gemini, Antigravity, Pi). See [`plugins/tangible-linear/`](plugins/tangible-linear/).
- **tangible-pbl** — an MCP server that authors Problem-Based Learning courses in Tangible
  from a single brief, stopping at six human approval gates. Claude Code only — it ships a
  server rather than skills. See [`plugins/tangible-pbl/`](plugins/tangible-pbl/).
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

## Releasing

**You never edit a version by hand.** Every plugin's version lives in up to six
manifests; writing one and forgetting the others is what used to cause drift.

`plugins/<name>/.claude-plugin/plugin.json` is the canonical version. Everything
else is written for you:

| File | Written by |
|---|---|
| `plugins/<name>/package.json` | release-please |
| `plugins/<name>/.claude-plugin/plugin.json` | release-please |
| `plugins/<name>/gemini-extension.json` | release-please |
| `plugins/<name>/.codex-plugin/plugin.json` | release-please |
| `plugins/<name>/.cursor-plugin/plugin.json` | release-please |
| `.claude-plugin/marketplace.json` | `scripts/sync-marketplace.mjs`, in CI |

### What you do

Commit with a conventional message whose changes land under the plugin's
directory. release-please routes commits by **path**, not by scope:

```
feat(tangible-pbl): add sub-content-unit creation     → minor bump
fix(tangible-pbl): stop leaking the courseId          → patch bump
docs(tangible-pbl): clarify the approval gates        → no release
```

Only `feat:` and `fix:` cut a release. Everything else still ships to users —
delivery is `ref: main`, so users get whatever is on `main` — it just doesn't
move the version.

### What happens then

1. You merge to `main`.
2. release-please opens a **release PR** for each plugin with new `feat:`/`fix:`
   commits, bumping every in-package manifest and writing a CHANGELOG.
3. A job on that PR syncs `.claude-plugin/marketplace.json` into it, so the PR
   carries a complete, self-consistent version bump.
4. You merge the release PR. That tags `<plugin>-v<version>` and cuts a GitHub
   Release.

**Merge with rebase.** The repo allows rebase only, and that is load-bearing:
a merge commit (or a squash) carries the *pull request title* as its message
across every path the branch touched. A PR titled `feat(...)` that happens to
touch `plugins/tangible-linear/` will cut a minor release for that plugin even
if the change was a one-line fix. This is not hypothetical — it happened, and
it is why `tangible-linear` briefly showed a spurious `1.2.0`.

### Guardrails

`node scripts/validate.mjs` runs on every PR and fails if any manifest disagrees
with another, or if `marketplace.json` was hand-edited. Run it locally before
pushing.

For `tangible-pbl` specifically, CI rebuilds `dist/` and fails if the committed
output differs from a clean build — `/plugin install` never runs a build, so a
source change without a rebuilt `dist/` would ship a stale server to everyone.
**Rebuild and commit `dist/` with any source change.**

The three scaffold plugins are not registered for automated releases (they have
no `package.json`). `validate.mjs` warns about each one on every run; that is
expected, not a failure.

## Access

Private to the `tangiblecareers` org. Not for external distribution.
