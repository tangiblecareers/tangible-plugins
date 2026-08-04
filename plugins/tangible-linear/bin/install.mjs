#!/usr/bin/env node
// Universal installer for the tangible-linear plugin.
// Symlinks the skill (and Claude Code commands) into each agent's skills dir so
// `git pull` in this repo keeps every agent up to date.
import { existsSync, mkdirSync, rmSync, symlinkSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // repo root (bin/ sits under it)
const HOME = homedir();
const SKILLS_DIR = join(ROOT, 'skills');
const SKILL_NAMES = readdirSync(SKILLS_DIR).filter((n) => statSync(join(SKILLS_DIR, n)).isDirectory());
const CMD_SRC = join(ROOT, 'commands');

function link(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  rmSync(dest, { recursive: true, force: true }); // idempotent: replace existing link/dir
  symlinkSync(src, dest);
}

const done = [];
const skipped = [];

function place(label, src, dest) {
  try { link(src, dest); done.push(label + '  →  ' + dest.replace(HOME, '~')); }
  catch (e) { skipped.push(label + ' (' + dest.replace(HOME, '~') + ') — ' + e.message); }
}

// Per-agent global skill locations (each agent discovers skills from its own dir).
// Every skill under skills/ is linked into each agent's skills dir.
const SKILL_DESTS = [
  ['Codex · Copilot',      join(HOME, '.agents', 'skills')],   // cross-runtime alias
  ['Claude Code',          join(HOME, '.claude', 'skills')],
  ['Antigravity · Gemini', join(HOME, '.gemini', 'config', 'skills')],
  ['Pi',                   join(HOME, '.pi', 'agent', 'skills')],
];
for (const [label, base] of SKILL_DESTS)
  for (const name of SKILL_NAMES)
    place(label + ' (' + name + ')', join(SKILLS_DIR, name), join(base, name));

// Claude Code slash commands (Claude-Code-only).
try {
  if (existsSync(CMD_SRC)) {
    for (const f of readdirSync(CMD_SRC).filter((n) => n.endsWith('.md'))) link(join(CMD_SRC, f), join(HOME, '.claude', 'commands', f));
    done.push('Claude Code commands  →  ~/.claude/commands/*.md  (/linear, /linear-dump, /sprint-plan)');
  }
} catch (e) { skipped.push('~/.claude/commands — ' + e.message); }

console.log('\ntangible-linear installed:');
for (const d of done) console.log('  ✓ ' + d);
for (const s of skipped) console.log('  • skipped ' + s);
console.log('\nSkills auto-load from the dirs above in Claude Code, Codex, Copilot, Antigravity, Gemini, and Pi.');
console.log('Workspace-scoped alternative (per repo): symlink the skill into <repo>/.agents/skills/ (Antigravity/Pi honor it).');
console.log('Cursor / opencode / Claude Code plugin-marketplace install: see README.md → Install.\n');
