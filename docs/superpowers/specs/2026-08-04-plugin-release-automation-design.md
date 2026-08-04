# Plugin release automation — design

Date: 2026-08-04
Status: implemented on `feat/release-automation`; reviewed and revised after the
whole-branch review moved the marketplace sync from the release pull request to
`main`. This document describes what shipped.

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
  "last-release-sha": "6cff6619b983c42bce329bb8c64ae3071d03eab0",
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

`validate.mjs` imports `collectVersions` and `planUpdates` directly and reports
any stale entry as one of its own errors — it does not shell out to `--check`.
Either way a hand-edited marketplace version fails CI on the pull request that
introduces it, which is what turns drift from a detectable condition into an
unrepresentable one. `--check` remains as a manual affordance for running the
same comparison without writing.

### Workflows

New `.github/workflows/release.yml`, triggered only by pushes to `main`, with
two sequential jobs.

**`release`.** Runs `googleapis/release-please-action@v4` with the config and
manifest files above. It opens or updates one release pull request per plugin
with changed `feat:`/`fix:` commits; when that pull request is merged — itself a
push to `main` — the next run tags (`tangible-pbl-v0.1.1`) and cuts a GitHub
Release carrying the changelog. Permissions: `contents: write`,
`pull-requests: write`.

**`sync-marketplace`, `needs: release`.** Checks out `main`, runs
`node scripts/sync-marketplace.mjs`, and commits and pushes
`.claude-plugin/marketplace.json` to `main` if it changed.

#### Why the sync runs on `main` and not on the release pull request

The first design put this job on `pull_request` filtered to
`release-please--*` head branches, so the marketplace update would land *inside*
the release pull request and one merge would produce one consistent state.
**That cannot work.** GitHub does not create workflow runs from events raised by
`GITHUB_TOKEN`, and release-please runs under that token — so the pull request
it opens fires no `pull_request` event at all. The sync job would never run, and
neither would `validate` on that branch. The first merge would land
`plugin.json 0.1.1` beside `marketplace.json 0.1.0` on `main`, with `validate`
failing only *after* the tag had been cut.

Closing that properly needs a PAT or GitHub App token so release-please's pull
request looks like it came from a human. We chose not to introduce a
long-lived credential for this, and moved the sync to `main` instead.

The same no-retrigger rule now works in our favour: the sync job's own push to
`main` raises no further workflow run, so there is no loop and no need for a
guard against one.

The cost is a real one and is accepted: between the release pull request
merging and the sync job's push, `main` briefly carries a `marketplace.json`
whose versions lag the plugin manifests. During that window `validate` on `main`
would fail if it ran. The window is one job long, and `needs: release` keeps the
two ordered.

Two details survive from the first design and remain load-bearing:

- **Both jobs declare `concurrency:`** keyed on `github.ref`, both with
  `cancel-in-progress: false`. Two pushes to `main` in quick succession must not
  produce two overlapping syncs racing to push, and a release run that may be
  cutting a tag must never be interrupted.
- **The push is explicit:** `persist-credentials: true` on checkout and
  `git push origin HEAD:main`. Both behaviours are `actions/checkout` defaults
  today, so the bare form worked — but the job's entire purpose is landing a
  commit, and that should not rest on an undeclared default.

The fork guard from the first design is gone with the `pull_request` trigger
that made it necessary.

### dist freshness gate

A new job in the existing `.github/workflows/validate.yml`, so it runs on every
pull request rather than only at release time — by release time a stale `dist/`
is already too late:

```bash
cd plugins/tangible-pbl
npm ci
npm run build
cd ../..
git status --porcelain -- plugins/tangible-pbl/dist   # must be empty
```

A non-empty result means the committed `dist/` does not match a clean build.
This makes the `tangible-pbl` CLAUDE.md non-negotiable — "a source change
without a rebuilt `dist/` ships a stale server to everyone who installs" — a
machine check.

`git status --porcelain` rather than `git diff --exit-code`: `git diff` only
inspects *tracked* files, so adding `src/foo.ts` and forgetting to commit
`dist/foo.js` would leave the new output untracked and the gate green. That is
the likeliest form of the exact failure this job exists to prevent.

The gate is trustworthy because `package-lock.json` pins `typescript` exactly
and `npm ci` installs the lock verbatim; `tsc` output is a function of the
compiler version and `tsconfig.json`, which emits no source maps, no
`declarationMap` and no `.tsbuildinfo`, so nothing machine-dependent reaches
`dist/`. Regenerating the lockfile is the one thing that can shift the output —
and that should trigger a rebuild anyway.

## Bootstrap sequence

Order matters; each step makes the next one truthful.

1. **Push `18e37a6`.** `main` is currently ahead of `origin/main` by one commit.
   No automation can see work that is not on the remote.
2. **Fix the existing drift.** Set `tangible-linear`'s `.codex-plugin/plugin.json`
   and `.cursor-plugin/plugin.json` to `1.1.0`.
3. **Extend `validate.mjs`** to include those two files in its version-sync
   collection — the gap that let the drift through — and to warn when a plugin
   is absent from `release-please-config.json`.
4. **Add `sync-marketplace.mjs`** and import its comparison into `validate.mjs`.
5. **Add the release config and manifest**, seeded with `1.1.0` / `0.1.0` and a
   `last-release-sha` (see Decisions taken).
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

**History starts at `6cff661`.** The repo has no git tags, and a seeded manifest
tells release-please the *current* version but not where the last release
happened — so on its first run it would walk the entire history of each package
path. `tangible-pbl` would pick up `0f8824a feat(tangible-pbl): add PBL
course-authoring MCP server plugin` and release `0.2.0` rather than the `0.1.1`
decided above; `tangible-linear` would pick up four already-shipped `feat:`
commits and open an unsolicited `1.2.0` whose changelog replays the repo's
history. `release-please-config.json` therefore sets
`"last-release-sha": "6cff6619b983c42bce329bb8c64ae3071d03eab0"` — the merge
commit of PR #2, immediately before `18e37a6`.

A consequence worth stating: `tangible-linear` will also cut a `1.1.1`, because
this branch's `fix(marketplace): check codex/cursor manifests for version drift`
touches its Codex and Cursor manifests. That is correct — those manifests really
were wrong at 1.0.3 and really were fixed.

**No PAT or GitHub App token is introduced.** See "Why the sync runs on `main`."
The alternative was a long-lived credential; we took the one-job window instead.

## Risks and accepted limitations

- **JSONPath is used only in its simple `$.version` form.** Filter expressions
  are avoided entirely, since upstream support is unconfirmed. Every targeted
  field is a top-level `version` key.
- **`dist/` determinism** depends on the pinned Node version and the
  `typescript` resolved by `npm ci`. A `typescript` minor bump could produce a
  one-off diff; the fix is to rebuild and commit, which is the behaviour we want
  anyway.
- **The sync job pushes directly to `main`.** If branch protection requiring
  pull requests is later applied to `main`, that push will fail and the
  marketplace will stop tracking the plugin manifests. The failure is loud — the
  job goes red, and `validate` on the next push reports the stale entry by name —
  but it needs a human to act on it.
- **`marketplace.json` lags by one job after every release.** Accepted; see "Why
  the sync runs on `main`." A `validate` run that lands inside that window
  reports a stale marketplace correctly, which reads as a spurious failure.
- **The `dist` gate covers `tangible-pbl` only**, because it is the only plugin
  that compiles anything. Any future plugin with a build step needs its own job
  or a generalisation of this one.
- **The `dist` gate cannot detect an orphaned output file.** `tsc` does not prune
  `dist/` — deleting `src/foo.ts` leaves `dist/foo.js` behind, and both the
  committed tree and a fresh build contain it, so the gate sees no difference.
  Adding a `rm -rf dist` before the build would close this; it was left out to
  keep the job's diff honest about what changed.
- **The three scaffold plugins remain manual.** Intentional; revisit when they
  gain a `package.json`. Nothing releases them, and `sync-marketplace.mjs` is a
  no-op for them, so no wrong version is reachable — but hand-bumping one of
  their `plugin.json` files makes `validate` fail until `sync-marketplace.mjs`
  is run, and the warning text does not say so.

## Verification

The design is implemented correctly when all of the following hold:

1. `node scripts/validate.mjs` passes on a clean checkout.
2. Hand-editing a version in `marketplace.json` makes `validate.mjs` fail, and
   the failure message names the offending plugin.
3. Editing a file under `plugins/tangible-pbl/src/` without rebuilding makes the
   `dist` job fail. Adding a new `src/*.ts` without committing its build output
   also fails it — the gate reads untracked files, not just modified ones.
4. Merging this branch to `main` opens two release pull requests: `tangible-pbl`
   at `0.1.1` and `tangible-linear` at `1.1.1`. Neither replays history older
   than `6cff661`.
5. Merging the `tangible-pbl` one produces a `tangible-pbl-v0.1.1` tag and a
   GitHub Release, and the following `sync-marketplace` run pushes a
   `chore: sync marketplace versions` commit to `main` setting that plugin's
   marketplace entry to `0.1.1`.
6. After that commit, `node scripts/validate.mjs` passes on `main`.
7. A `docs(tangible-pbl):` commit merged to `main` opens no release pull request.
