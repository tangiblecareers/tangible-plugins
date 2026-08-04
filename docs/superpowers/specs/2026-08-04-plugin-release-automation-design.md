# Plugin release automation — design

Date: 2026-08-04
Status: approved, not yet implemented

## Problem

A plugin's version is duplicated across up to six manifests. Today every copy is
written by hand:

| File | Present for | Read by |
|---|---|---|
| `plugins/<name>/.claude-plugin/plugin.json` | all 5 plugins | Claude Code, after install |
| `plugins/<name>/package.json` | linear, pbl | npm and local tooling |
| `plugins/<name>/gemini-extension.json` | linear | Gemini |
| `plugins/<name>/.codex-plugin/plugin.json` | linear | Codex |
| `plugins/<name>/.cursor-plugin/plugin.json` | linear | Cursor |
| `.claude-plugin/marketplace.json` → matching entry | all 5 plugins | the marketplace listing users see |

`scripts/validate.mjs` compares these and errors on drift, and
`.github/workflows/validate.yml` runs it on every pull request and every push to
`main`. That check is incomplete, and the gap has already cost us:

```
tangible-linear:  .claude-plugin/plugin.json  1.1.0
                  package.json                1.1.0
                  gemini-extension.json       1.1.0
                  .codex-plugin/plugin.json   1.0.3   ← stale
                  .cursor-plugin/plugin.json  1.0.3   ← stale
```

`validate.mjs` never reads the last two files, so CI is green on this drift.

Separately, `tangible-pbl` has never been bumped. It is `0.1.0` everywhere,
including across commit `18e37a6`, which restored the plugin to the marketplace
after a structural bug had silently removed it — a user-visible fix shipped
under the version of the broken state.

Delivery and versioning are independent here, which is what makes the version
easy to forget. Every marketplace entry uses `source: git-subdir` at
`ref: main`, so **users receive whatever is on `main`** whether or not anyone
touched a version field. The version is the signal that an update exists, not
the mechanism that delivers it.

## Goals

- A merge to `main` produces the correct version bump in every manifest, with no
  human step.
- Version drift becomes unrepresentable rather than merely detectable.
- A source change that ships without a rebuilt `dist/` fails CI.

## Non-goals

- Publishing to npm. All packages are `private` or unpublished; releases here
  mean git tags, changelogs, and the marketplace version.
- Changing how plugins are delivered. `ref: main` stays.
- Automating the three empty scaffolds (`tangible-git`, `tangible-api`,
  `tangible-review`). They have no `package.json` and no content.

## Constraint that shapes the design

release-please cannot update a file outside its package directory. A `../`
path is rejected before anything else is evaluated:

```
Error: release-please failed: illegal pathing characters in path:
actions/check-auto-sync/../../.github/workflows/check-auto-sync.yaml
```

`.claude-plugin/marketplace.json` is at the repo root while plugins live under
`plugins/<name>/`, and it holds five independent versions — so it cannot be
modeled as a root package with one version either. Whether JSONPath filter
expressions (`$.plugins[?(@.name=='tangible-pbl')].version`) work is also
unconfirmed; the one upstream issue asking about it failed on pathing before the
filter was ever exercised.

Conclusion: no off-the-shelf tool updates `marketplace.json` for us. A sync step
exists in any design. The question is only where it lives — so we keep it as
small as possible and let a battle-tested tool do everything else.

References: [customizing.md](https://github.com/googleapis/release-please/blob/main/docs/customizing.md),
[issue #2477](https://github.com/googleapis/release-please/issues/2477),
[issue #2064](https://github.com/googleapis/release-please/issues/2064).

## Design

### Source of truth

`plugins/<name>/.claude-plugin/plugin.json` holds the canonical version. Files
inside the package directory are written by release-please;
`marketplace.json` is derived from them. No version is hand-edited again.

### release-please configuration

Root `release-please-config.json`, one entry per released plugin, with
`separate-pull-requests: true` so plugins release independently of each other.
Every `extra-files` path is relative to the package directory, which is the only
form release-please supports:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "separate-pull-requests": true,
  "packages": {
    "plugins/tangible-linear": {
      "release-type": "node",
      "component": "tangible-linear",
      "extra-files": [
        { "type": "json", "path": ".claude-plugin/plugin.json", "jsonpath": "$.version" },
        { "type": "json", "path": "gemini-extension.json",      "jsonpath": "$.version" },
        { "type": "json", "path": ".codex-plugin/plugin.json",  "jsonpath": "$.version" },
        { "type": "json", "path": ".cursor-plugin/plugin.json", "jsonpath": "$.version" }
      ]
    },
    "plugins/tangible-pbl": {
      "release-type": "node",
      "component": "tangible-pbl",
      "extra-files": [
        { "type": "json", "path": ".claude-plugin/plugin.json", "jsonpath": "$.version" }
      ]
    }
  }
}
```

`release-type: node` updates `package.json` itself, so it is not listed under
`extra-files`.

Root `.release-please-manifest.json`, seeded with the versions that are true
after the drift fix below:

```json
{
  "plugins/tangible-linear": "1.1.0",
  "plugins/tangible-pbl": "0.1.0"
}
```

The three scaffold plugins are deliberately unregistered. They stay at `0.1.0`
until they have real content, and `validate.mjs` already warns about plugins
missing from the marketplace; we add a matching warning for plugins missing from
the release config so they are not silently forgotten.

### Commit routing

release-please assigns a commit to a package by **the file paths the commit
touched**, not by the conventional-commit scope. Our scopes already match
directory names (`feat(tangible-pbl):`, `feat(tangible-linear):`), so the two
agree in practice — but path routing is the actual mechanism, and it is what
governs the edge cases in "Decisions taken" below.

Only `feat:` and `fix:` trigger a release, which is release-please's default.

### `scripts/sync-marketplace.mjs`

A new script in the style of the existing `validate.mjs` — node built-ins only,
no dependencies. It:

1. Reads `version` and `name` from every `plugins/*/.claude-plugin/plugin.json`.
2. Writes each version into the `.claude-plugin/marketplace.json` entry with the
   matching `name`.

Only the `version` field is derived. `description`, `category`, and the `source`
block stay hand-owned, so nothing written by hand is clobbered.

Two modes:

- default — write the file, exit 0.
- `--check` — write nothing; exit non-zero and print which entries are stale.

`validate.mjs` calls `--check`. A hand-edited marketplace version therefore
fails CI on the pull request that introduces it, which is what turns drift from
a detectable condition into an unrepresentable one.

### Workflows

New `.github/workflows/release.yml`, two jobs on different triggers:

**`release` — on push to `main`.** Runs `googleapis/release-please-action@v4`
with the config and manifest files above. It opens or updates one release pull
request per plugin with changed `feat:`/`fix:` commits; on merge it tags
(`tangible-pbl-v0.1.1`) and cuts a GitHub Release carrying the changelog.
Permissions: `contents: write`, `pull-requests: write`.

**`sync-marketplace` — on `pull_request` where `github.head_ref` starts with
`release-please--`.** Checks out the pull request branch, runs
`node scripts/sync-marketplace.mjs`, and commits and pushes if the file changed.

The sync deliberately lands *inside* the release pull request rather than as a
bot commit on `main` afterwards. One merge produces one consistent state, and
there is never a window where the marketplace disagrees with the plugins.
`GITHUB_TOKEN` can push to same-repo pull request branches; those pushes do not
retrigger workflows, which is acceptable because nothing needs to run after.

### dist freshness gate

A new job in the existing `.github/workflows/validate.yml`, so it runs on every
pull request rather than only at release time — by release time a stale `dist/`
is already too late:

```bash
cd plugins/tangible-pbl
npm ci
npm run build
git diff --exit-code -- dist/
```

A non-zero exit means the committed `dist/` does not match a clean build. This
makes the `tangible-pbl` CLAUDE.md non-negotiable — "a source change without a
rebuilt `dist/` ships a stale server to everyone who installs" — a machine
check. The workflow pins `node-version`, and `typescript` comes from `npm ci`,
so `tsc` output is deterministic across runs.

## Bootstrap sequence

Order matters; each step makes the next one truthful.

1. **Push `18e37a6`.** `main` is currently ahead of `origin/main` by one commit.
   No automation can see work that is not on the remote.
2. **Fix the existing drift.** Set `tangible-linear`'s `.codex-plugin/plugin.json`
   and `.cursor-plugin/plugin.json` to `1.1.0`.
3. **Extend `validate.mjs`** to include those two files in its version-sync
   collection — the gap that let the drift through — and to warn when a plugin
   is absent from `release-please-config.json`.
4. **Add `sync-marketplace.mjs`** and wire `--check` into `validate.mjs`.
5. **Add the release config and manifest**, seeded with `1.1.0` / `0.1.0`.
6. **Add `release.yml`** and the `dist` job in `validate.yml`.

## Decisions taken

**`tangible-pbl` releases as `0.1.1`.** Commit `18e37a6` touched
`.claude-plugin/marketplace.json` and `plugins/tangible-pbl/CLAUDE.md`, so path
routing attributes it to `tangible-pbl` and cuts a patch release. Its scope is
`fix(marketplace):` and half its content is documentation, so the changelog entry
will read a little oddly. Accepted: the marketplace fix is genuinely
user-visible and deserves a version.

**Only `feat:` and `fix:` bump.** `chore:`, `docs:`, and `ci:` commits under a
plugin path ship to users — because delivery is `ref: main` — without changing
the version. That is the intended meaning: the version marks "the code changed,"
not "any file changed."

## Risks and accepted limitations

- **JSONPath is used only in its simple `$.version` form.** Filter expressions
  are avoided entirely, since upstream support is unconfirmed. Every targeted
  field is a top-level `version` key.
- **`dist/` determinism** depends on the pinned Node version and the
  `typescript` resolved by `npm ci`. A `typescript` minor bump could produce a
  one-off diff; the fix is to rebuild and commit, which is the behaviour we want
  anyway.
- **The sync job pushes to a bot branch.** If branch protection is later applied
  to `release-please--*` branches, that push will fail and the marketplace will
  fall out of sync inside the release pull request. `validate.mjs --check` would
  catch it on that same pull request, so the failure is loud rather than silent.
- **The three scaffold plugins remain manual.** Intentional; revisit when they
  gain a `package.json`.

## Verification

The design is implemented correctly when all of the following hold:

1. `node scripts/validate.mjs` passes on a clean checkout.
2. Hand-editing a version in `marketplace.json` makes `validate.mjs` fail, and
   the failure message names the offending plugin.
3. Editing a file under `plugins/tangible-pbl/src/` without rebuilding makes the
   `dist` job fail.
4. A `fix(tangible-pbl):` commit merged to `main` opens a release pull request
   that updates `package.json`, `.claude-plugin/plugin.json`, **and**
   `.claude-plugin/marketplace.json` to the same new version.
5. Merging that pull request produces a `tangible-pbl-v0.1.1` tag and a GitHub
   Release.
6. A `docs(tangible-pbl):` commit merged to `main` opens no release pull request.
