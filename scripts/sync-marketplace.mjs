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
