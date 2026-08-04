# Plugin Release Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merge to `main` bumps a plugin's version in every manifest automatically, and a stale `dist/` fails CI.

**Architecture:** `plugins/<name>/.claude-plugin/plugin.json` becomes the canonical version. release-please owns commit parsing, version math, changelogs and tags, writing only files inside each plugin directory. A dependency-free `scripts/sync-marketplace.mjs` derives the root `.claude-plugin/marketplace.json` versions from the canonical files, and `scripts/validate.mjs` fails CI if that derivation is ever out of date.

**Tech Stack:** Node 20 (built-in modules only — no new dependencies), GitHub Actions, `googleapis/release-please-action@v4`.

## Global Constraints

- **No new runtime dependencies.** `scripts/*.mjs` use `node:` built-ins only, matching the existing `validate.mjs` header comment: "dependency-free (node built-ins only)".
- **Node version is pinned to `"20"`** in every workflow, matching the existing `validate.yml`.
- **Conventional commits, `type(scope): subject`.** Scope is the plugin directory name (`tangible-pbl`, `tangible-linear`) or `marketplace` / `ci` / `docs` for repo-level work.
- **No co-author trailers** on any commit. Neither this repo nor `tangible-internal-tools` uses them.
- **ESM only.** All scripts are `.mjs` with `import` syntax; the repo has no root `package.json`.
- **JSONPath is only ever the simple `$.version` form.** Filter expressions are forbidden — upstream support is unconfirmed.
- **Only `feat:` and `fix:` trigger a release.** This is release-please's default; do not add `changelog-sections` overrides.
- **Testing is by deliberate breakage.** This repo has no test runner. A check is proven by hand-patching the repo into the state it should reject, confirming the check fails, then restoring and confirming it passes. This is the practice `plugins/tangible-pbl/CLAUDE.md` already mandates: "verify it by hand-patching the code to that regression and confirming the test fails."

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `plugins/tangible-linear/.codex-plugin/plugin.json` | Modify | Version corrected 1.0.3 → 1.1.0 |
| `plugins/tangible-linear/.cursor-plugin/plugin.json` | Modify | Version corrected 1.0.3 → 1.1.0 |
| `scripts/validate.mjs` | Modify | Add codex/cursor manifests to the drift check; add marketplace-derivation check; warn on plugins absent from release config |
| `scripts/sync-marketplace.mjs` | Create | Read canonical versions, derive marketplace versions, `--check` mode |
| `release-please-config.json` | Create | Per-plugin release config |
| `.release-please-manifest.json` | Create | Current version state release-please reads |
| `.github/workflows/release.yml` | Create | release-please job + marketplace sync job |
| `.github/workflows/validate.yml` | Modify | Add the `dist` freshness job |

---

### Task 0: Push the pending commits

`main` is ahead of `origin/main` by 2 commits (`18e37a6` marketplace fix, `51a9143` design spec). Nothing below can be exercised on GitHub until they are on the remote, and release-please will attribute `18e37a6` to `tangible-pbl` when it first runs.

**Files:** none (git only)

- [ ] **Step 1: Confirm with the user before pushing**

Pushing is outward-facing and publishes the marketplace fix to every installer. Ask explicitly; do not push on your own initiative.

- [ ] **Step 2: Verify what will be pushed**

Run: `git log --oneline origin/main..main`
Expected: exactly `51a9143` and `18e37a6`, nothing else.

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Verify**

Run: `git status -sb | head -1`
Expected: `## main...origin/main` with no `ahead` marker.

---

### Task 1: Close the drift gap in `validate.mjs`

The validator reads four manifest kinds but the repo has six. `tangible-linear`'s Codex and Cursor manifests sit at 1.0.3 while everything else is 1.1.0, and CI is green. Fix the data, then fix the check that missed it.

**Files:**
- Modify: `plugins/tangible-linear/.codex-plugin/plugin.json`
- Modify: `plugins/tangible-linear/.cursor-plugin/plugin.json`
- Modify: `scripts/validate.mjs:~75` (the block reading `gemini-extension.json`)

**Interfaces:**
- Consumes: nothing.
- Produces: a `versions` object inside `validate.mjs`'s per-plugin loop now keyed by six possible manifest names — `plugin.json`, `package.json`, `gemini-extension.json`, `.codex-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `marketplace.json`.

- [ ] **Step 1: Confirm the validator currently misses the drift**

Run: `node scripts/validate.mjs`
Expected: PASS — `✓ validation passed — 5 plugin(s), 0 warning(s)`, despite `.codex-plugin/plugin.json` being 1.0.3. This is the bug.

- [ ] **Step 2: Extend the validator to read both manifests**

In `scripts/validate.mjs`, immediately after the `gemini-extension.json` block:

```js
  const gemJson = join(dir, 'gemini-extension.json');
  if (existsSync(gemJson)) { const j = readJSON(gemJson); if (j) versions['gemini-extension.json'] = j.version; }
```

add:

```js
  for (const eco of ['.codex-plugin', '.cursor-plugin']) {
    const ecoJson = join(dir, eco, 'plugin.json');
    if (existsSync(ecoJson)) {
      const j = readJSON(ecoJson);
      if (j) versions[`${eco}/plugin.json`] = j.version;
    }
  }
```

- [ ] **Step 3: Run the validator to verify it now fails**

Run: `node scripts/validate.mjs`
Expected: FAIL, exit 1, with a line naming all five versions:
`✗ plugins/tangible-linear: version drift — plugin.json=1.1.0, package.json=1.1.0, gemini-extension.json=1.1.0, .codex-plugin/plugin.json=1.0.3, .cursor-plugin/plugin.json=1.0.3, marketplace.json=1.1.0`

- [ ] **Step 4: Correct both stale versions**

In `plugins/tangible-linear/.codex-plugin/plugin.json` and `plugins/tangible-linear/.cursor-plugin/plugin.json`, change:

```json
  "version": "1.0.3",
```

to:

```json
  "version": "1.1.0",
```

- [ ] **Step 5: Run the validator to verify it passes**

Run: `node scripts/validate.mjs`
Expected: PASS — `✓ validation passed — 5 plugin(s), 0 warning(s)`

- [ ] **Step 6: Commit**

```bash
git add scripts/validate.mjs plugins/tangible-linear/.codex-plugin/plugin.json plugins/tangible-linear/.cursor-plugin/plugin.json
git commit -m "fix(marketplace): check codex/cursor manifests for version drift"
```

---

### Task 2: Derive marketplace versions from plugin manifests

`marketplace.json` is the file release-please structurally cannot write. This task makes it a derived artifact so no human needs to.

**Files:**
- Create: `scripts/sync-marketplace.mjs`
- Modify: `scripts/validate.mjs` (import the helpers; add the staleness check)

**Interfaces:**
- Consumes: `plugins/*/.claude-plugin/plugin.json` `name` and `version` fields.
- Produces two named exports used by `validate.mjs`:
  - `collectVersions(root: string) => Map<string, string>` — plugin `name` → canonical `version`.
  - `planUpdates(marketplace: object, versions: Map<string,string>) => Array<{name: string, from: string, to: string}>` — entries whose marketplace version disagrees with the canonical one. Empty array means in sync.

- [ ] **Step 1: Write the script**

Create `scripts/sync-marketplace.mjs`:

```js
#!/usr/bin/env node
// Derives .claude-plugin/marketplace.json versions from each plugin's canonical
// .claude-plugin/plugin.json. Only the `version` field is derived — description,
// category and source stay hand-owned.
// Run: node scripts/sync-marketplace.mjs [--check]
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MARKETPLACE = join(ROOT, '.claude-plugin', 'marketplace.json');

// plugin name -> canonical version, read from each plugin's plugin.json
export function collectVersions(root = ROOT) {
  const out = new Map();
  const pluginsDir = join(root, 'plugins');
  if (!existsSync(pluginsDir)) return out;
  for (const dir of readdirSync(pluginsDir)) {
    if (!statSync(join(pluginsDir, dir)).isDirectory()) continue;
    const manifest = join(pluginsDir, dir, '.claude-plugin', 'plugin.json');
    if (!existsSync(manifest)) continue;
    const j = JSON.parse(readFileSync(manifest, 'utf8'));
    if (j.name && j.version) out.set(j.name, j.version);
  }
  return out;
}

// marketplace entries whose version disagrees with the canonical one
export function planUpdates(marketplace, versions) {
  const stale = [];
  for (const entry of marketplace.plugins ?? []) {
    const want = versions.get(entry.name);
    if (want && entry.version !== want) {
      stale.push({ name: entry.name, from: entry.version, to: want });
    }
  }
  return stale;
}

function main() {
  const check = process.argv.includes('--check');
  const marketplace = JSON.parse(readFileSync(MARKETPLACE, 'utf8'));
  const versions = collectVersions();
  const stale = planUpdates(marketplace, versions);

  if (stale.length === 0) {
    console.log('✓ marketplace versions in sync');
    return;
  }

  if (check) {
    console.error(`✗ marketplace.json is stale — ${stale.length} entr(ies):`);
    for (const s of stale) console.error(`  ✗ ${s.name}: ${s.from} → ${s.to}`);
    console.error('  run: node scripts/sync-marketplace.mjs');
    process.exit(1);
  }

  for (const entry of marketplace.plugins ?? []) {
    const want = versions.get(entry.name);
    if (want) entry.version = want;
  }
  writeFileSync(MARKETPLACE, JSON.stringify(marketplace, null, 2) + '\n');
  for (const s of stale) console.log(`  ✎ ${s.name}: ${s.from} → ${s.to}`);
  console.log(`✓ marketplace.json updated — ${stale.length} entr(ies)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

Note: the first write reformats `marketplace.json` — `JSON.stringify(…, null, 2)` expands the currently-inlined `"owner"` and `"source"` objects. This is a one-time churn; the output is stable on every run afterwards.

- [ ] **Step 2: Verify it reports in-sync on the current tree**

Run: `node scripts/sync-marketplace.mjs --check`
Expected: PASS, exit 0 — `✓ marketplace versions in sync`. All five plugins currently agree.

- [ ] **Step 3: Break it deliberately and confirm `--check` catches it**

Temporarily edit `.claude-plugin/marketplace.json`, changing the `tangible-pbl` entry's `"version": "0.1.0"` to `"version": "9.9.9"`.

Run: `node scripts/sync-marketplace.mjs --check`
Expected: FAIL, exit 1 —
```
✗ marketplace.json is stale — 1 entr(ies):
  ✗ tangible-pbl: 9.9.9 → 0.1.0
  run: node scripts/sync-marketplace.mjs
```

- [ ] **Step 4: Confirm the write mode repairs it**

Run: `node scripts/sync-marketplace.mjs`
Expected: `✎ tangible-pbl: 9.9.9 → 0.1.0` then `✓ marketplace.json updated — 1 entr(ies)`.

Run: `node scripts/sync-marketplace.mjs --check`
Expected: PASS — `✓ marketplace versions in sync`.

Run: `git diff --stat .claude-plugin/marketplace.json`
Expected: only the reformat, with `tangible-pbl` back at `0.1.0`. Confirm by eye that all five entries still have their `description`, `category` and `source` blocks.

- [ ] **Step 5: Wire the check into `validate.mjs`**

At the top of `scripts/validate.mjs`, after the existing `node:url` import, add:

```js
import { collectVersions, planUpdates } from './sync-marketplace.mjs';
```

Then, immediately after the existing per-plugin `for` loop ends and before the `// Report` comment, add:

```js
// 3. Marketplace versions must be derived, not hand-written
if (marketplace) {
  for (const s of planUpdates(marketplace, collectVersions(ROOT))) {
    err(`marketplace.json: "${s.name}" is ${s.from} but plugin.json says ${s.to} — run node scripts/sync-marketplace.mjs`);
  }
}
```

- [ ] **Step 6: Verify the integrated check fails on drift**

Temporarily change the `tangible-pbl` marketplace entry to `"version": "9.9.9"` again.

Run: `node scripts/validate.mjs`
Expected: FAIL, exit 1, containing both the pre-existing per-plugin drift error and:
`✗ marketplace.json: "tangible-pbl" is 9.9.9 but plugin.json says 0.1.0 — run node scripts/sync-marketplace.mjs`

- [ ] **Step 7: Restore and verify green**

Run: `node scripts/sync-marketplace.mjs && node scripts/validate.mjs`
Expected: PASS — `✓ validation passed — 5 plugin(s), 0 warning(s)`

- [ ] **Step 8: Commit**

```bash
git add scripts/sync-marketplace.mjs scripts/validate.mjs .claude-plugin/marketplace.json
git commit -m "feat(marketplace): derive marketplace versions from plugin manifests"
```

---

### Task 3: Add the release-please configuration

**Files:**
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`
- Modify: `scripts/validate.mjs` (warn on plugins absent from the release config)

**Interfaces:**
- Consumes: `collectVersions` from Task 2 is *not* used here; this task reads `release-please-config.json` directly.
- Produces: `release-please-config.json` with a top-level `packages` object keyed by package path (`plugins/tangible-linear`, `plugins/tangible-pbl`), each carrying a `component` equal to the plugin name.

- [ ] **Step 1: Write the release config**

Create `release-please-config.json`:

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
        { "type": "json", "path": "gemini-extension.json", "jsonpath": "$.version" },
        { "type": "json", "path": ".codex-plugin/plugin.json", "jsonpath": "$.version" },
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

`release-type: node` updates each package's own `package.json`, which is why it is absent from `extra-files`. The three scaffold plugins (`tangible-git`, `tangible-api`, `tangible-review`) are omitted on purpose — they have no `package.json`, so `release-type: node` cannot apply.

- [ ] **Step 2: Write the version manifest**

Create `.release-please-manifest.json`:

```json
{
  "plugins/tangible-linear": "1.1.0",
  "plugins/tangible-pbl": "0.1.0"
}
```

These must equal the versions on disk after Task 1. Confirm with:

Run: `node -e "for (const p of ['tangible-linear','tangible-pbl']) console.log(p, JSON.parse(require('fs').readFileSync('plugins/'+p+'/.claude-plugin/plugin.json','utf8')).version)"`
Expected: `tangible-linear 1.1.0` and `tangible-pbl 0.1.0`.

- [ ] **Step 3: Add the unregistered-plugin warning to `validate.mjs`**

In `scripts/validate.mjs`, directly below the block added in Task 2 Step 5, add:

```js
// 4. Every plugin should be registered for automated releases
const releaseCfgPath = join(ROOT, 'release-please-config.json');
const releaseCfg = existsSync(releaseCfgPath) ? readJSON(releaseCfgPath) : null;
if (!releaseCfg) err('release-please-config.json is missing or unparseable');
else {
  for (const name of pluginDirs) {
    if (!releaseCfg.packages?.[`plugins/${name}`]) {
      warn(`plugins/${name}: not registered in release-please-config.json — releases are manual`);
    }
  }
}
```

- [ ] **Step 4: Run the validator and confirm exactly three warnings**

Run: `node scripts/validate.mjs`
Expected: PASS, exit 0, preceded by:
```
  ⚠ plugins/tangible-api: not registered in release-please-config.json — releases are manual
  ⚠ plugins/tangible-git: not registered in release-please-config.json — releases are manual
  ⚠ plugins/tangible-review: not registered in release-please-config.json — releases are manual
```
and ending `✓ validation passed — 5 plugin(s), 3 warning(s)`. `tangible-linear` and `tangible-pbl` must NOT appear.

- [ ] **Step 5: Confirm a missing config is an error, not a warning**

Run: `mv release-please-config.json /tmp/rp.json && node scripts/validate.mjs; echo "exit=$?"; mv /tmp/rp.json release-please-config.json`
Expected: `✗ release-please-config.json is missing or unparseable` and `exit=1`.

- [ ] **Step 6: Commit**

```bash
git add release-please-config.json .release-please-manifest.json scripts/validate.mjs
git commit -m "feat(marketplace): add release-please config for linear and pbl"
```

---

### Task 4: Add the release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `release-please-config.json` and `.release-please-manifest.json` from Task 3; `scripts/sync-marketplace.mjs` from Task 2.
- Produces: git tags of the form `<component>-v<version>` (e.g. `tangible-pbl-v0.1.1`) and GitHub Releases.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: release

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: write
  pull-requests: write

jobs:
  release:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

  sync-marketplace:
    if: github.event_name == 'pull_request' && startsWith(github.head_ref, 'release-please--')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }}
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Derive marketplace versions
        run: node scripts/sync-marketplace.mjs
      - name: Commit if changed
        run: |
          if [ -n "$(git status --porcelain .claude-plugin/marketplace.json)" ]; then
            git config user.name "github-actions[bot]"
            git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
            git add .claude-plugin/marketplace.json
            git commit -m "chore: sync marketplace versions"
            git push
          fi
```

The sync runs on the release pull request branch rather than on `main` afterwards, so one merge yields one consistent state and the marketplace never disagrees with the plugins on `main`.

- [ ] **Step 2: Verify the YAML parses**

Run: `node -e "const s=require('fs').readFileSync('.github/workflows/release.yml','utf8'); if(!/jobs:/.test(s)||/\t/.test(s)) { console.error('bad'); process.exit(1);} console.log('ok')"`
Expected: `ok` — no tab characters, `jobs:` present. (There is no YAML parser available without adding a dependency; GitHub validates the rest on push.)

- [ ] **Step 3: Verify the sync job's condition logic by hand**

Confirm by reading: the `release` job runs only on `push` (so it never runs on pull requests), and `sync-marketplace` runs only on `pull_request` with a `release-please--` head branch (so it never touches a human's branch). These two conditions must be mutually exclusive — if both could fire on one event, the sync would race the release.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release-please workflow with marketplace sync"
```

---

### Task 5: Add the dist freshness gate

`plugins/tangible-pbl/CLAUDE.md` states the failure mode: "`/plugin install` fetches files via `git-subdir` and never runs a build, so a source change without a rebuilt `dist/` ships a stale server to everyone who installs." This turns that into a machine check on every pull request.

**Files:**
- Modify: `.github/workflows/validate.yml`

**Interfaces:**
- Consumes: `plugins/tangible-pbl/package.json`'s `build` script (`tsc -p tsconfig.json`) and `package-lock.json`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Confirm the build is reproducible locally first**

Run: `cd plugins/tangible-pbl && npm ci && npm run build && git diff --exit-code -- dist; echo "exit=$?"`
Expected: `exit=0` — the committed `dist/` already matches a clean build. If it does not, stop: `dist/` is currently stale and must be rebuilt and committed before a gate can be added, otherwise the gate lands red.

- [ ] **Step 2: Add the job**

In `.github/workflows/validate.yml`, after the existing `validate` job, add a sibling job at the same indentation:

```yaml
  dist:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install and rebuild tangible-pbl
        working-directory: plugins/tangible-pbl
        run: |
          npm ci
          npm run build
      - name: Fail if dist/ is stale
        run: git diff --exit-code -- plugins/tangible-pbl/dist
```

- [ ] **Step 3: Prove the gate catches a stale dist**

Edit `plugins/tangible-pbl/src/config.ts` — add a trailing comment line `// gate probe` at the end of the file — then, **without rebuilding**, run the gate's command:

Run: `git diff --exit-code -- plugins/tangible-pbl/dist; echo "exit=$?"`
Expected: `exit=0`. This is the important subtlety: editing a source file alone does not make `dist/` differ, because `dist/` on disk is still the last build. The gate only detects staleness *after* the workflow rebuilds. So verify it properly:

Run: `cd plugins/tangible-pbl && npm run build && cd ../.. && git diff --stat -- plugins/tangible-pbl/dist`
Expected: `plugins/tangible-pbl/dist/config.js` shows as modified — the rebuild materialises the difference, which is exactly what CI does before diffing.

- [ ] **Step 4: Restore**

```bash
git checkout -- plugins/tangible-pbl/src/config.ts plugins/tangible-pbl/dist
```

Run: `cd plugins/tangible-pbl && npm run build && cd ../.. && git diff --exit-code -- plugins/tangible-pbl/dist; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 5: Run the full validator one more time**

Run: `node scripts/validate.mjs`
Expected: PASS — `✓ validation passed — 5 plugin(s), 3 warning(s)`

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/validate.yml
git commit -m "ci(tangible-pbl): fail the build when dist/ is stale"
```

---

## Post-merge verification

These cannot be checked locally — they require the workflows to run on GitHub. Walk them after the branch merges to `main`.

- [ ] release-please opens a release pull request for `tangible-pbl` attributing `18e37a6` (which touched `.claude-plugin/marketplace.json` and `plugins/tangible-pbl/CLAUDE.md`) and proposing `0.1.1`.
- [ ] That pull request contains updated `package.json`, `.claude-plugin/plugin.json`, **and** `.claude-plugin/marketplace.json`, all reading `0.1.1`.
- [ ] CI on that pull request is green — proving `sync-marketplace` pushed before `validate` ran, or that `validate` re-ran after the push.
- [ ] Merging it creates the tag `tangible-pbl-v0.1.1` and a GitHub Release.
- [ ] A subsequent `docs(tangible-pbl):` commit opens no release pull request.
