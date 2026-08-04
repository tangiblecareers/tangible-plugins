#!/usr/bin/env node
// Marketplace validator — dependency-free (node built-ins only).
// Checks, per plugin: JSON well-formedness, version sync across every manifest,
// skill frontmatter (name + description), and command frontmatter (description).
// Run: node scripts/validate.mjs   (exits non-zero on any error)
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { err(`${rel(path)}: invalid JSON — ${e.message}`); return null; }
}
const rel = (p) => p.replace(ROOT + '/', '');

// Parse a leading YAML-ish frontmatter block: only need top-level `key: value`.
function frontmatter(path) {
  const txt = readFileSync(path, 'utf8');
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

// 1. Marketplace file
const marketplacePath = join(ROOT, '.claude-plugin', 'marketplace.json');
const marketplace = existsSync(marketplacePath) ? readJSON(marketplacePath) : null;
if (!marketplace) err('.claude-plugin/marketplace.json is missing or unparseable');
const marketVersions = new Map();
for (const p of marketplace?.plugins ?? []) {
  if (!p.name) err('marketplace.json: a plugin entry has no name');
  if (!p.version) err(`marketplace.json: plugin "${p.name}" has no version`);
  else marketVersions.set(p.name, p.version);
}

// 2. Per-plugin checks
const pluginsDir = join(ROOT, 'plugins');
const pluginDirs = existsSync(pluginsDir)
  ? readdirSync(pluginsDir).filter((n) => statSync(join(pluginsDir, n)).isDirectory())
  : [];

for (const name of pluginDirs) {
  const dir = join(pluginsDir, name);
  const versions = {};

  const pluginJson = join(dir, '.claude-plugin', 'plugin.json');
  if (existsSync(pluginJson)) {
    const j = readJSON(pluginJson);
    if (j) { versions['plugin.json'] = j.version; if (!j.name) err(`${rel(pluginJson)}: missing name`); if (!j.description) err(`${rel(pluginJson)}: missing description`); }
  } else err(`plugins/${name}: missing .claude-plugin/plugin.json`);

  const pkgJson = join(dir, 'package.json');
  if (existsSync(pkgJson)) { const j = readJSON(pkgJson); if (j) versions['package.json'] = j.version; }

  const gemJson = join(dir, 'gemini-extension.json');
  if (existsSync(gemJson)) { const j = readJSON(gemJson); if (j) versions['gemini-extension.json'] = j.version; }

  if (marketVersions.has(name)) versions['marketplace.json'] = marketVersions.get(name);

  // Version sync
  const distinct = [...new Set(Object.values(versions).filter(Boolean))];
  if (distinct.length > 1) {
    const detail = Object.entries(versions).map(([k, v]) => `${k}=${v}`).join(', ');
    err(`plugins/${name}: version drift — ${detail}`);
  }
  if (!marketVersions.has(name)) warn(`plugins/${name}: not listed in marketplace.json`);

  // Skills: frontmatter name + description
  const skillsDir = join(dir, 'skills');
  if (existsSync(skillsDir)) {
    for (const s of readdirSync(skillsDir).filter((n) => statSync(join(skillsDir, n)).isDirectory())) {
      const skillMd = join(skillsDir, s, 'SKILL.md');
      if (!existsSync(skillMd)) { err(`plugins/${name}/skills/${s}: missing SKILL.md`); continue; }
      const fm = frontmatter(skillMd);
      if (!fm) err(`${rel(skillMd)}: missing frontmatter block`);
      else { if (!fm.name) err(`${rel(skillMd)}: frontmatter missing name`); if (!fm.description) err(`${rel(skillMd)}: frontmatter missing description`); }
    }
  }

  // Commands: frontmatter description
  const cmdDir = join(dir, 'commands');
  if (existsSync(cmdDir)) {
    for (const c of readdirSync(cmdDir).filter((n) => n.endsWith('.md'))) {
      const fm = frontmatter(join(cmdDir, c));
      if (!fm || !fm.description) err(`${rel(join(cmdDir, c))}: command missing frontmatter description`);
    }
  }

  // workspace.json (optional) must at least parse if present
  const wsJson = join(dir, 'workspace.json');
  if (existsSync(wsJson)) readJSON(wsJson);
}

// Report
for (const w of warnings) console.log(`  ⚠ ${w}`);
if (errors.length) {
  console.error(`\n✗ validation failed — ${errors.length} error(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`\n✓ validation passed — ${pluginDirs.length} plugin(s), ${warnings.length} warning(s)`);
