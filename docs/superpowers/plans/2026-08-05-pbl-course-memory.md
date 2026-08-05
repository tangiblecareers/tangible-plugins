# tangible-pbl Course Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the JSON session pointer with one durable, human-readable markdown file per course that records the decisions made at each gate and can be resumed later.

**Architecture:** `src/session/memory.ts` replaces `src/session/store.ts`, holding a frontmatter codec, slug allocation, and an append-only store that writes via `rename()`. `src/session/reconcile.ts` is a pure comparison of memory against the live course. `src/tools/session.ts` writes exactly one log entry per human decision and gains `pbl_resume`. `machine.ts` keeps its `MachineDeps` boundary untouched.

**Tech Stack:** TypeScript (ESM, NodeNext), vitest, `node:fs/promises`. No new dependencies — the package depends on `@modelcontextprotocol/sdk` and `zod` and nothing else.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-05-pbl-course-memory-design.md`. Where this plan and the spec disagree, the deviations in "Spec deviations found while planning" below are authoritative — they were checked against the code.
- **No new dependencies.** No YAML parser. Frontmatter is flat `key: value` with JSON-encoded values.
- **ESM with NodeNext:** every relative import needs the `.js` extension even though sources are `.ts`.
- **`assertSafeId`'s `/^[A-Za-z0-9_-]+$/` is kept exactly as-is** and applied to every slug. It is one of the layered environment-isolation measures `plugins/tangible-pbl/CLAUDE.md` requires be kept intact. Do not loosen it to accommodate slugs — kebab-case already satisfies it.
- **Environment namespacing is preserved:** `courses/<env>/`. Same reason.
- **No UUID in any output.** `courseId` in the review URL remains the single documented exception. This applies to error messages too.
- **`advance()` keeps exactly two call sites** — `pbl_approve` and `pbl_revise` — and moves exactly one step per invocation. `test/machine.test.ts` enforces this. Nothing in this plan may add a third.
- **Rebuild and commit `dist/` in every task that changes `src/`.** `.github/workflows/validate.yml` now fails the build when `dist/` is stale, so a task that edits `src/` and does not run `npm run build` before committing will land red.
- **Conventional commits, scope `tangible-pbl`. No co-author trailers.**
- **Every new test is verified by breaking the code it covers and confirming it fails.** `CLAUDE.md` mandates this after two could-not-fail tests shipped: a negative assertion only has force when the forbidden path is reachable in the fixture, and a boundary test must use the value *at* the boundary.

## Spec deviations found while planning

Three things in the spec do not survive contact with the code. Each is resolved here; do not "fix" them back.

1. **`machine.ts` does need a change.** The spec says "`machine.ts` needs no logic change." Its `done()` helper at `src/session/machine.ts:97` builds `history: [...state.history, to]`. Dropping `history` requires deleting that one property. The spec's actual intent — that the `MachineDeps` boundary stays untouched and no API call moves into `machine.ts` — holds. Task 5 makes this one-line edit.
2. **Reconcile cannot compare content-unit counts.** The spec's example output reads "Memory recorded 4 content units; the course now has 6", but no frontmatter field stores a unit count and the spec's frontmatter example does not add one. Rather than invent a field, `reconcile` reports the live unit count as context and does not treat it as a difference. Differences are limited to what memory actually holds: title, course status versus recorded step, and published status.
3. **`save()` gains an optional second parameter.** The spec says the store "keeps `save`, `load` and `list` with their current shapes." A log entry has to reach the store somehow, and threading it through `CourseMemory` would make a frontmatter-only save indistinguishable from one carrying an entry. `save(memory, entry?)` is additive — every existing call site stays valid.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/session/memory.ts` | Create | Frontmatter codec, slug allocation, append-only store. Replaces `store.ts`. |
| `src/session/store.ts` | Delete | Superseded (Task 6). |
| `src/session/reconcile.ts` | Create | Pure `(memory, course, units) → Difference[]`. |
| `src/session/machine.ts` | Modify | Drop `history` from `done()`; retarget the `SessionState` import. |
| `src/session/ledger.ts` | Modify | Retarget the import; `renderLedger` unchanged. |
| `src/tools/session.ts` | Modify | Log entries per gate; `pbl_abort` closes; `pbl_status` shows status; add `pbl_resume`. |
| `src/server.ts` | Modify | `SessionStore` → `CourseMemoryStore`. |
| `test/memory.test.ts` | Create | Replaces `test/store.test.ts`. |
| `test/reconcile.test.ts` | Create | Reconcile cases. |
| `test/store.test.ts` | Delete | Rewritten as `memory.test.ts` (Task 6). |

---

### Task 1: Frontmatter codec

The parser is the one place a hand-edited file can break the plugin, so it is built and tested before anything depends on it.

**Files:**
- Create: `plugins/tangible-pbl/src/session/memory.ts`
- Create: `plugins/tangible-pbl/test/memory.test.ts`

**Interfaces:**
- Consumes: `Env` from `../config.js`.
- Produces:
  - `type Step` and `type CourseStatusLabel = 'active' | 'closed' | 'published'`
  - `interface CourseMemory { id, title, env, courseId, businessName, brief, sourceUrl?, step, awaitingApproval, status, created, updated }` — `id` is the slug; `created`/`updated` are ISO strings.
  - `interface LogEntry { step: Step; action: 'approved' | 'revised' | 'published' | 'invited' | 'closed'; detail: string }`
  - `serializeFrontmatter(m: CourseMemory): string`
  - `parseFrontmatter(text: string, file: string): Record<string, unknown>`
  - `splitDocument(text: string, file: string): { front: Record<string, unknown>; body: string }`

- [ ] **Step 1: Write the failing tests**

Create `plugins/tangible-pbl/test/memory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  serializeFrontmatter, parseFrontmatter, splitDocument,
  type CourseMemory,
} from '../src/session/memory.js';

const memory = (over: Partial<CourseMemory> = {}): CourseMemory => ({
  id: 'intro-to-systems-thinking',
  title: 'Intro to Systems Thinking',
  env: 'staging',
  courseId: 'c1',
  businessName: 'Acme',
  brief: 'a brief',
  step: 'context',
  awaitingApproval: true,
  status: 'active',
  created: '2026-08-05T10:00:00.000Z',
  updated: '2026-08-05T10:00:00.000Z',
  ...over,
});

describe('frontmatter codec', () => {
  it('round-trips a value containing a colon and a double quote', () => {
    const m = memory({ businessName: 'Acme: "The" Inc', title: 'A: B' });
    const front = parseFrontmatter(serializeFrontmatter(m), 'f.md');
    expect(front.business).toBe('Acme: "The" Inc');
    expect(front.course).toBe('A: B');
  });

  it('round-trips unicode and newline-free free text', () => {
    const m = memory({ title: 'Systèmes — 系统 🌍' });
    const front = parseFrontmatter(serializeFrontmatter(m), 'f.md');
    expect(front.course).toBe('Systèmes — 系统 🌍');
  });

  it('writes booleans bare and reads them back as booleans', () => {
    const text = serializeFrontmatter(memory({ awaitingApproval: false }));
    expect(text).toContain('awaitingApproval: false');
    expect(parseFrontmatter(text, 'f.md').awaitingApproval).toBe(false);
  });

  it('omits sourceUrl when absent and includes it when present', () => {
    expect(serializeFrontmatter(memory())).not.toContain('sourceUrl');
    const withUrl = serializeFrontmatter(memory({ sourceUrl: 'https://x.test/b' }));
    expect(parseFrontmatter(withUrl, 'f.md').sourceUrl).toBe('https://x.test/b');
  });

  it('names the file and line when a frontmatter line is malformed', () => {
    const text = '---\ncourse: "A"\nthis is not a pair\n---\n\nbody\n';
    expect(() => parseFrontmatter(text, 'bad.md')).toThrow(/bad\.md:3/);
  });

  it('names the file and line when a value is not valid JSON', () => {
    const text = '---\ncourse: not-json\n---\n\nbody\n';
    expect(() => parseFrontmatter(text, 'bad.md')).toThrow(/bad\.md:2/);
  });

  it('rejects a file with no frontmatter block', () => {
    expect(() => parseFrontmatter('# just a heading\n', 'bare.md')).toThrow(
      /bare\.md: no frontmatter block/,
    );
  });

  it('splits frontmatter from body without altering the body', () => {
    const body = '# Title\n\n## Brief\nhello\n\n## Notes\nmine\n';
    const { front, body: out } = splitDocument(
      `${serializeFrontmatter(memory())}\n\n${body}`, 'f.md',
    );
    expect(front.course).toBe('Intro to Systems Thinking');
    expect(out).toBe(body);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plugins/tangible-pbl && npx vitest run test/memory.test.ts`
Expected: FAIL — `Failed to resolve import "../src/session/memory.js"`.

- [ ] **Step 3: Write the codec**

Create `plugins/tangible-pbl/src/session/memory.ts`:

```ts
import type { Env } from '../config.js';

export type Step =
  | 'context' | 'skills' | 'problems' | 'outline'
  | 'detail' | 'publish' | 'invite' | 'done';

export type CourseStatusLabel = 'active' | 'closed' | 'published';

/**
 * One authored course. `id` is the slug, which is also the filename stem — it
 * is never read from the frontmatter, so renaming a file renames the course.
 */
export interface CourseMemory {
  id: string;
  title: string;
  env: Env;
  courseId: string;
  businessName: string;
  brief: string;
  sourceUrl?: string;
  step: Step;
  awaitingApproval: boolean;
  status: CourseStatusLabel;
  created: string;
  updated: string;
}

export interface LogEntry {
  step: Step;
  action: 'approved' | 'revised' | 'published' | 'invited' | 'closed';
  detail: string;
}

/**
 * Flat `key: value` only, values JSON-encoded. A real YAML parser would be a
 * new dependency for a format we fully control, and JSON encoding is what lets
 * colons, quotes and unicode round-trip without escaping rules of our own.
 * Anything free-form (the brief, rationale) lives in the body, where it cannot
 * break parsing.
 */
export const serializeFrontmatter = (m: CourseMemory): string => {
  const pairs: [string, unknown][] = [
    ['course', m.title],
    ['env', m.env],
    ['courseId', m.courseId],
    ['business', m.businessName],
    ['step', m.step],
    ['awaitingApproval', m.awaitingApproval],
    ['status', m.status],
    ['created', m.created],
    ['updated', m.updated],
  ];
  if (m.sourceUrl) pairs.push(['sourceUrl', m.sourceUrl]);
  return ['---', ...pairs.map(([k, v]) => `${k}: ${JSON.stringify(v)}`), '---'].join('\n');
};

const FRONT_RE = /^---\n([\s\S]*?)\n---/;
const PAIR_RE = /^([A-Za-z][A-Za-z0-9_]*): (.*)$/;

export const parseFrontmatter = (
  text: string,
  file: string,
): Record<string, unknown> => {
  const m = FRONT_RE.exec(text);
  if (!m) {
    throw new Error(
      `${file}: no frontmatter block — the file must start with a "---" fenced block.`,
    );
  }
  const out: Record<string, unknown> = {};
  const lines = m[1]!.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    // +2: line 1 is the opening "---", so body line i is file line i + 2.
    const at = `${file}:${i + 2}`;
    const kv = PAIR_RE.exec(line);
    if (!kv) throw new Error(`${at}: expected "key: value", got ${JSON.stringify(line)}`);
    try {
      out[kv[1]!] = JSON.parse(kv[2]!);
    } catch {
      throw new Error(
        `${at}: value for "${kv[1]}" is not valid JSON — got ${JSON.stringify(kv[2])}`,
      );
    }
  }
  return out;
};

export const splitDocument = (
  text: string,
  file: string,
): { front: Record<string, unknown>; body: string } => {
  const front = parseFrontmatter(text, file);
  const m = FRONT_RE.exec(text)!;
  return { front, body: text.slice(m[0].length).replace(/^\n+/, '') };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd plugins/tangible-pbl && npx vitest run test/memory.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Prove the line-number tests can fail**

Temporarily change `${file}:${i + 2}` to `${file}:${i + 1}` in `parseFrontmatter`.

Run: `cd plugins/tangible-pbl && npx vitest run test/memory.test.ts`
Expected: FAIL — both "names the file and line" tests. This proves the off-by-one is actually covered; a test asserting only `/bad\.md/` would have passed either way.

Restore `i + 2` and re-run. Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
cd plugins/tangible-pbl && npx tsc --noEmit && npm run build && cd ../..
git add plugins/tangible-pbl/src/session/memory.ts plugins/tangible-pbl/test/memory.test.ts plugins/tangible-pbl/dist
git commit -m "feat(tangible-pbl): add course memory frontmatter codec"
```

---

### Task 2: Slug allocation

**Files:**
- Modify: `plugins/tangible-pbl/src/session/memory.ts`
- Modify: `plugins/tangible-pbl/test/memory.test.ts`

**Interfaces:**
- Consumes: `Step`, `CourseMemory` from Task 1.
- Produces: `slugify(title: string | undefined, brief: string): string` — kebab-cases the title, or falls back to the first five words of the brief. Output always satisfies `/^[A-Za-z0-9_-]+$/`.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/tangible-pbl/test/memory.test.ts` (and add `slugify` to the import from `../src/session/memory.js`):

```ts
describe('slugify', () => {
  it('kebab-cases a title', () => {
    expect(slugify('Intro to Systems Thinking', 'ignored')).toBe('intro-to-systems-thinking');
  });

  it('strips punctuation and collapses separators', () => {
    expect(slugify('A: B — "C"  D!', 'ignored')).toBe('a-b-c-d');
  });

  it('falls back to the first five words of the brief when there is no title', () => {
    expect(slugify(undefined, 'Design a course on urban water systems for students'))
      .toBe('design-a-course-on-urban');
  });

  it('falls back when the title kebab-cases to nothing', () => {
    expect(slugify('!!! ???', 'Water systems for cities')).toBe('water-systems-for-cities');
  });

  it('always produces something assertSafeId accepts', () => {
    for (const t of ['系统 思考', '   ', '../../etc/passwd', 'Ünïcodé Cøursé']) {
      expect(slugify(t, 'fallback brief text here')).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd plugins/tangible-pbl && npx vitest run test/memory.test.ts -t slugify`
Expected: FAIL — `slugify is not a function` / import error.

- [ ] **Step 3: Implement `slugify`**

Append to `plugins/tangible-pbl/src/session/memory.ts`:

```ts
const kebab = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * `Course.title` is optional on the API, so the brief is the fallback. The
 * result always satisfies assertSafeId — non-latin titles kebab to '' and fall
 * through, and 'course' is the last resort when both inputs are unusable.
 */
export const slugify = (title: string | undefined, brief: string): string =>
  kebab(title ?? '') ||
  kebab(brief.trim().split(/\s+/).slice(0, 5).join(' ')) ||
  'course';
```

- [ ] **Step 4: Run to verify pass**

Run: `cd plugins/tangible-pbl && npx vitest run test/memory.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Prove the traversal case is real**

Confirm by reading the test: `slugify('../../etc/passwd', …)` must not produce a string containing `.` or `/`. Run this one-liner to see the actual value:

Run: `cd plugins/tangible-pbl && node -e "const s=(t)=>t.normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+\$/g,''); console.log(JSON.stringify(s('../../etc/passwd')))"`
Expected: `"etc-passwd"` — no dots, no slashes.

- [ ] **Step 6: Commit**

```bash
cd plugins/tangible-pbl && npx tsc --noEmit && npm run build && cd ../..
git add plugins/tangible-pbl/src/session/memory.ts plugins/tangible-pbl/test/memory.test.ts plugins/tangible-pbl/dist
git commit -m "feat(tangible-pbl): derive course slugs from title or brief"
```

---

### Task 3: The append-only store

**Files:**
- Modify: `plugins/tangible-pbl/src/session/memory.ts`
- Modify: `plugins/tangible-pbl/test/memory.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–2.
- Produces: `class CourseMemoryStore` with
  - `constructor(root = join(homedir(), '.tangible-pbl-mcp', 'courses'), now: () => Date = () => new Date())`
  - `save(m: CourseMemory, entry?: LogEntry): Promise<void>`
  - `load(env: Env, id: string): Promise<CourseMemory>`
  - `list(env: Env): Promise<CourseMemory[]>`
  - `allocateSlug(env: Env, title: string | undefined, brief: string): Promise<string>`
  - No `delete` — `pbl_abort` closes rather than deletes, and an uncalled method would reintroduce the dead code this work removes.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/tangible-pbl/test/memory.test.ts`, adding the imports `mkdtemp`, `rm`, `readFile`, `readdir` from `node:fs/promises`, `tmpdir` from `node:os`, `join` from `node:path`, `beforeEach`/`afterEach` from vitest, and `CourseMemoryStore`, `type LogEntry` from the module:

```ts
describe('CourseMemoryStore', () => {
  let root: string;
  let store: CourseMemoryStore;
  const at = new Date('2026-08-05T10:12:00.000Z');

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pbl-memory-'));
    store = new CourseMemoryStore(root, () => at);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
    step: 'skills', action: 'approved', detail: 'Kept 6 of 11.', ...over,
  });

  it('round-trips a memory', async () => {
    await store.save(memory());
    const loaded = await store.load('staging', 'intro-to-systems-thinking');
    expect(loaded).toEqual(memory());
  });

  it('round-trips a brief containing markdown headings and colons', async () => {
    const brief = 'Line one: with colon\n\n## Not a real section\n\nmore text';
    await store.save(memory({ brief }));
    expect((await store.load('staging', 'intro-to-systems-thinking')).brief).toBe(brief);
  });

  it('namespaces by environment', async () => {
    await store.save(memory());
    await expect(store.load('production', 'intro-to-systems-thinking')).rejects.toThrow(
      /No course "intro-to-systems-thinking" in production/,
    );
  });

  it('keeps same-slug courses in different environments apart', async () => {
    await store.save(memory());
    await store.save(memory({ env: 'production', courseId: 'c2' }));
    expect((await store.load('staging', 'intro-to-systems-thinking')).courseId).toBe('c1');
    expect((await store.load('production', 'intro-to-systems-thinking')).courseId).toBe('c2');
  });

  it('lists only the requested environment, including closed courses', async () => {
    await store.save(memory());
    await store.save(memory({ id: 'second', status: 'closed' }));
    await store.save(memory({ id: 'third', env: 'production' }));
    const ids = (await store.list('staging')).map((m) => m.id).sort();
    expect(ids).toEqual(['intro-to-systems-thinking', 'second']);
  });

  it('returns an empty list when the environment has no courses', async () => {
    await expect(store.list('production')).resolves.toEqual([]);
  });

  it('skips an unreadable file instead of failing the whole listing', async () => {
    await store.save(memory());
    await writeFile(join(root, 'staging', 'broken.md'), 'not a memory file\n', 'utf8');
    const ids = (await store.list('staging')).map((m) => m.id);
    expect(ids).toEqual(['intro-to-systems-thinking']);
  });

  it('rejects path traversal with absolute paths', async () => {
    await expect(store.load('staging', '../../etc/passwd')).rejects.toThrow(
      /Invalid course id/,
    );
  });

  it('rejects path traversal to sibling environments', async () => {
    await expect(store.load('staging', '../production/x')).rejects.toThrow(
      /Invalid course id/,
    );
  });

  it('rejects save with an unsafe id and creates nothing outside root', async () => {
    await expect(store.save(memory({ id: '../outside/payload' }))).rejects.toThrow(
      /Invalid course id/,
    );
    expect(await readdir(root)).not.toContain('outside');
  });

  it('appends a log entry before the Notes heading', async () => {
    await store.save(memory());
    await store.save(memory(), entry());
    const text = await readFile(
      join(root, 'staging', 'intro-to-systems-thinking.md'), 'utf8',
    );
    expect(text).toContain('### 10:12 · skills — approved\nKept 6 of 11.');
    expect(text.indexOf('### 10:12')).toBeLessThan(text.indexOf('## Notes'));
  });

  it('preserves hand-written Notes text and earlier entries byte-for-byte', async () => {
    await store.save(memory());
    await store.save(memory(), entry({ detail: 'first entry' }));
    const file = join(root, 'staging', 'intro-to-systems-thinking.md');
    const edited = (await readFile(file, 'utf8')).replace(
      '## Notes\n', '## Notes\nmy hand-written note\n',
    );
    await writeFile(file, edited, 'utf8');

    await store.save(memory({ step: 'problems' }), entry({ detail: 'second entry' }));

    const text = await readFile(file, 'utf8');
    expect(text).toContain('my hand-written note');
    expect(text).toContain('first entry');
    expect(text).toContain('second entry');
    expect(text.indexOf('first entry')).toBeLessThan(text.indexOf('second entry'));
  });

  it('rewrites frontmatter without touching the body when no entry is given', async () => {
    await store.save(memory());
    await store.save(memory(), entry({ detail: 'only entry' }));
    const file = join(root, 'staging', 'intro-to-systems-thinking.md');
    const before = (await readFile(file, 'utf8')).split('\n---\n')[1]!;

    await store.save(memory({ awaitingApproval: false }));

    const after = await readFile(file, 'utf8');
    expect(after.split('\n---\n')[1]!).toBe(before);
    expect(after).toContain('awaitingApproval: false');
  });

  it('leaves no .tmp file behind', async () => {
    await store.save(memory());
    await store.save(memory(), entry());
    const names = await readdir(join(root, 'staging'));
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('allocates a colliding slug as -2, then -3', async () => {
    const a = await store.allocateSlug('staging', 'Intro to Systems Thinking', 'b');
    await store.save(memory({ id: a }));
    const b = await store.allocateSlug('staging', 'Intro to Systems Thinking', 'b');
    await store.save(memory({ id: b }));
    const c = await store.allocateSlug('staging', 'Intro to Systems Thinking', 'b');
    expect([a, b, c]).toEqual([
      'intro-to-systems-thinking',
      'intro-to-systems-thinking-2',
      'intro-to-systems-thinking-3',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd plugins/tangible-pbl && npx vitest run test/memory.test.ts`
Expected: FAIL — `CourseMemoryStore is not a constructor`.

- [ ] **Step 3: Implement the store**

Append to `plugins/tangible-pbl/src/session/memory.ts` (add the imports at the top of the file):

```ts
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
```

```ts
const assertSafeId = (id: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid course id "${id}".`);
  }
  return id;
};

const NOTES = '## Notes';

const section = (body: string, heading: string): string => {
  const start = body.indexOf(`## ${heading}\n`);
  if (start === -1) return '';
  const from = start + `## ${heading}\n`.length;
  const next = body.indexOf('\n## ', from);
  return body.slice(from, next === -1 ? undefined : next + 1).trim();
};

const hhmm = (d: Date): string =>
  `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

export const renderEntry = (e: LogEntry, at: Date): string =>
  `### ${hhmm(at)} · ${e.step} — ${e.action}\n${e.detail}\n`;

const freshBody = (m: CourseMemory): string =>
  [
    `# ${m.title}`,
    `${m.env} · ${m.businessName}`,
    '',
    '## Brief',
    m.brief,
    '',
    '## Log',
    '',
    NOTES,
    '',
  ].join('\n');

/**
 * Insert immediately before the Notes heading so entries stay in chronological
 * order and hand-written notes stay at the bottom. Everything outside the
 * inserted block passes through verbatim — a revise appends a second entry
 * rather than rewriting the first, which is what "why did this change" needs.
 */
const insertEntry = (body: string, rendered: string): string => {
  const at = body.indexOf(NOTES);
  if (at === -1) return `${body.replace(/\n*$/, '')}\n\n${rendered}`;
  return `${body.slice(0, at)}${rendered}\n${body.slice(at)}`;
};

export class CourseMemoryStore {
  constructor(
    private readonly root = join(homedir(), '.tangible-pbl-mcp', 'courses'),
    private readonly now: () => Date = () => new Date(),
  ) {}

  #dir(env: Env) {
    return join(this.root, env);
  }

  #file(env: Env, id: string) {
    return join(this.#dir(env), `${assertSafeId(id)}.md`);
  }

  async save(m: CourseMemory, entry?: LogEntry): Promise<void> {
    const file = this.#file(m.env, m.id);
    await mkdir(this.#dir(m.env), { recursive: true });

    let body: string;
    try {
      body = splitDocument(await readFile(file, 'utf8'), file).body;
    } catch {
      body = freshBody(m);
    }
    if (entry) body = insertEntry(body, renderEntry(entry, this.now()));

    const next: CourseMemory = { ...m, updated: this.now().toISOString() };
    const tmp = `${file}.tmp`;
    await writeFile(tmp, `${serializeFrontmatter(next)}\n\n${body}`, 'utf8');
    // rename() is atomic on POSIX: a crash leaves either the previous file or
    // the complete new one, never a torn write.
    await rename(tmp, file);
  }

  async load(env: Env, id: string): Promise<CourseMemory> {
    const file = this.#file(env, id);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      throw new Error(
        `No course "${id}" in ${env}. Run pbl_status to see what is here.`,
      );
    }
    return this.#parse(text, file, id, env);
  }

  #parse(text: string, file: string, id: string, env: Env): CourseMemory {
    const { front, body } = splitDocument(text, file);
    return {
      id,
      title: String(front.course ?? id),
      env,
      courseId: String(front.courseId ?? ''),
      businessName: String(front.business ?? ''),
      brief: section(body, 'Brief'),
      ...(front.sourceUrl ? { sourceUrl: String(front.sourceUrl) } : {}),
      step: front.step as Step,
      awaitingApproval: front.awaitingApproval === true,
      status: front.status as CourseStatusLabel,
      created: String(front.created ?? ''),
      updated: String(front.updated ?? ''),
    };
  }

  async list(env: Env): Promise<CourseMemory[]> {
    let names: string[];
    try {
      names = await readdir(this.#dir(env));
    } catch {
      return [];
    }
    const out: CourseMemory[] = [];
    for (const n of names.filter((n) => n.endsWith('.md'))) {
      const file = join(this.#dir(env), n);
      try {
        out.push(this.#parse(await readFile(file, 'utf8'), file, n.slice(0, -3), env));
      } catch {
        // Skip an unreadable file rather than failing the whole listing.
      }
    }
    return out;
  }

  async allocateSlug(env: Env, title: string | undefined, brief: string): Promise<string> {
    const base = slugify(title, brief);
    let taken: string[];
    try {
      taken = await readdir(this.#dir(env));
    } catch {
      return base;
    }
    const has = (s: string) => taken.includes(`${s}.md`);
    if (!has(base)) return base;
    for (let n = 2; ; n++) {
      if (!has(`${base}-${n}`)) return `${base}-${n}`;
    }
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd plugins/tangible-pbl && npx vitest run test/memory.test.ts`
Expected: PASS — 28 tests.

- [ ] **Step 5: Prove the append-only test can fail**

Temporarily change `save` so it always starts from `freshBody(m)` — replace the `try`/`catch` block with `body = freshBody(m);`.

Run: `cd plugins/tangible-pbl && npx vitest run test/memory.test.ts`
Expected: FAIL — "preserves hand-written Notes text and earlier entries byte-for-byte" and "rewrites frontmatter without touching the body". This proves those tests actually exercise the preservation path.

Restore the `try`/`catch` and re-run. Expected: PASS.

- [ ] **Step 6: Prove the traversal test can fail**

Temporarily change `assertSafeId`'s regex to `/.*/`.

Run: `cd plugins/tangible-pbl && npx vitest run test/memory.test.ts`
Expected: FAIL — all three traversal tests.

Restore `/^[A-Za-z0-9_-]+$/` and re-run. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd plugins/tangible-pbl && npx tsc --noEmit && npm run build && cd ../..
git add plugins/tangible-pbl/src/session/memory.ts plugins/tangible-pbl/test/memory.test.ts plugins/tangible-pbl/dist
git commit -m "feat(tangible-pbl): add append-only course memory store"
```

---

### Task 4: Reconcile

**Files:**
- Create: `plugins/tangible-pbl/src/session/reconcile.ts`
- Create: `plugins/tangible-pbl/test/reconcile.test.ts`

**Interfaces:**
- Consumes: `CourseMemory` from Task 1; `Course`, `ContentUnit` from `../api/builder.js`.
- Produces:
  - `interface Difference { what: string; detail: string }`
  - `reconcile(m: CourseMemory, course: Course, units: ContentUnit[]): Difference[]`
  - `renderResume(m: CourseMemory, course: Course, units: ContentUnit[], differences: Difference[]): string`

- [ ] **Step 1: Write the failing tests**

Create `plugins/tangible-pbl/test/reconcile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reconcile, renderResume } from '../src/session/reconcile.js';
import type { CourseMemory } from '../src/session/memory.js';
import type { Course, ContentUnit } from '../src/api/builder.js';

const memory = (over: Partial<CourseMemory> = {}): CourseMemory => ({
  id: 'intro', title: 'Intro', env: 'staging', courseId: 'c1',
  businessName: 'Acme', brief: 'b', step: 'skills', awaitingApproval: true,
  status: 'active', created: '2026-08-05T10:00:00.000Z',
  updated: '2026-08-05T10:00:00.000Z', ...over,
});
const course = (over: Partial<Course> = {}): Course =>
  ({ id: 'c1', title: 'Intro', status: 'INITIALIZING', ...over });
const units = (n: number): ContentUnit[] =>
  Array.from({ length: n }, (_, i) => ({ id: `u${i}`, title: `Unit ${i}` }));

describe('reconcile', () => {
  it('reports nothing when memory and backend agree', () => {
    expect(reconcile(memory(), course(), [])).toEqual([]);
  });

  it('reports a title change made in the web app', () => {
    const d = reconcile(memory(), course({ title: 'Renamed' }), []);
    expect(d).toHaveLength(1);
    expect(d[0]!.detail).toMatch(/Renamed/);
  });

  it('reports that the outline already exists when memory predates the freeze', () => {
    const d = reconcile(memory({ step: 'skills' }), course({ status: 'DRAFT' }), units(6));
    expect(d.map((x) => x.what)).toContain('course status');
    expect(d.find((x) => x.what === 'course status')!.detail).toMatch(/frozen/);
  });

  it('does not report the freeze once memory has reached outline', () => {
    const d = reconcile(memory({ step: 'outline' }), course({ status: 'DRAFT' }), units(6));
    expect(d.map((x) => x.what)).not.toContain('course status');
  });

  it('reports a backend publish the memory does not know about', () => {
    const d = reconcile(memory({ status: 'active' }), course({ status: 'PUBLISHED' }), units(2));
    expect(d.map((x) => x.what)).toContain('published');
  });

  it('never puts the courseId in a difference', () => {
    const m = memory({ courseId: '8f14e45f-ceea-467a-9f0e-0d0a0d0a0d0a' });
    const c = course({ id: '8f14e45f-ceea-467a-9f0e-0d0a0d0a0d0a', title: 'Renamed', status: 'PUBLISHED' });
    for (const d of reconcile(m, c, units(3))) {
      expect(`${d.what} ${d.detail}`).not.toContain('8f14e45f');
    }
  });
});

describe('renderResume', () => {
  it('states both sides and lists differences', () => {
    const out = renderResume(
      memory(), course({ status: 'DRAFT', title: 'Renamed' }), units(6),
      reconcile(memory(), course({ status: 'DRAFT', title: 'Renamed' }), units(6)),
    );
    expect(out).toContain('staging · Acme');
    expect(out).toContain('Memory says: skills, awaiting approval');
    expect(out).toContain('Backend says: DRAFT, 6 content units');
    expect(out).toMatch(/⚠/);
  });

  it('says so plainly when there is nothing to report', () => {
    const out = renderResume(memory(), course(), [], []);
    expect(out).toContain('In sync with the backend.');
    expect(out).not.toMatch(/⚠/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd plugins/tangible-pbl && npx vitest run test/reconcile.test.ts`
Expected: FAIL — cannot resolve `../src/session/reconcile.js`.

- [ ] **Step 3: Implement reconcile**

Create `plugins/tangible-pbl/src/session/reconcile.ts`:

```ts
import type { Course, ContentUnit } from '../api/builder.js';
import type { CourseMemory } from './memory.js';
import { STEP_ORDER } from './machine.js';

export interface Difference {
  what: string;
  detail: string;
}

/**
 * Pure comparison so it is testable without HTTP. Reports and never auto-fixes
 * — the backend is authoritative for content, and a memory that silently
 * rewrote itself to match would destroy the record this feature exists to keep.
 */
export const reconcile = (
  m: CourseMemory,
  course: Course,
  units: ContentUnit[],
): Difference[] => {
  const out: Difference[] = [];

  if (course.title && course.title !== m.title) {
    out.push({
      what: 'title',
      detail:
        `Memory calls this "${m.title}"; the course is now "${course.title}". ` +
        `The file keeps the slug it was created with.`,
    });
  }

  // Once the course is DRAFT the outline exists, which freezes contexts,
  // skills and problems permanently. Saying so now beats a confusing 403
  // several calls later.
  const reachedOutline = STEP_ORDER.indexOf(m.step) >= STEP_ORDER.indexOf('outline');
  if (course.status === 'DRAFT' && !reachedOutline) {
    out.push({
      what: 'course status',
      detail:
        `Memory stopped at "${m.step}", but the course is DRAFT — the outline ` +
        `already exists, so context, skills and problems are frozen. ` +
        `${units.length} content unit${units.length === 1 ? '' : 's'} present.`,
    });
  }

  if (course.status === 'PUBLISHED' && m.status !== 'published') {
    out.push({
      what: 'published',
      detail: 'The course is PUBLISHED, but this memory was never marked published.',
    });
  }

  return out;
};

export const renderResume = (
  m: CourseMemory,
  course: Course,
  units: ContentUnit[],
  differences: Difference[],
): string => {
  const head = [
    `Resumed "${m.title}" (${m.env} · ${m.businessName})`,
    `Memory says: ${m.step}${m.awaitingApproval ? ', awaiting approval' : ''}`,
    `Backend says: ${course.status}, ${units.length} content unit${units.length === 1 ? '' : 's'}`,
  ];
  if (differences.length === 0) return [...head, '', 'In sync with the backend.'].join('\n');
  return [
    ...head,
    '',
    ...differences.map((d) => `⚠ ${d.detail}`),
    '',
    'The backend is authoritative. Nothing was changed.',
  ].join('\n');
};
```

- [ ] **Step 4: Run to verify pass**

Run: `cd plugins/tangible-pbl && npx vitest run test/reconcile.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Prove the boundary test uses the boundary**

The freeze tests use `step: 'skills'` (before outline) and `step: 'outline'` (at the boundary). Verify the pair actually pins the comparison: temporarily change `>=` to `>` in `reachedOutline`.

Run: `cd plugins/tangible-pbl && npx vitest run test/reconcile.test.ts`
Expected: FAIL — "does not report the freeze once memory has reached outline". A pair using `skills` and `detail` would have passed here; that is the off-by-one `CLAUDE.md` says already shipped once.

Restore `>=` and re-run. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd plugins/tangible-pbl && npx tsc --noEmit && npm run build && cd ../..
git add plugins/tangible-pbl/src/session/reconcile.ts plugins/tangible-pbl/test/reconcile.test.ts plugins/tangible-pbl/dist
git commit -m "feat(tangible-pbl): reconcile course memory against the live course"
```

---

### Task 5: Retarget machine, ledger and server

Mechanical migration off `store.ts`, done before the tools layer so the tools task has a stable base.

**Files:**
- Modify: `plugins/tangible-pbl/src/session/machine.ts`
- Modify: `plugins/tangible-pbl/src/session/ledger.ts`
- Modify: `plugins/tangible-pbl/src/server.ts`
- Modify: `plugins/tangible-pbl/test/machine.test.ts`

**Interfaces:**
- Consumes: `CourseMemory`, `Step`, `CourseMemoryStore` from Tasks 1–3.
- Produces: `machine.ts` and `ledger.ts` typed against `CourseMemory`; `Runtime.store` is a `CourseMemoryStore`.

- [ ] **Step 1: Retarget `machine.ts`**

Replace the import at `src/session/machine.ts:2`:

```ts
import type { SessionState, Step } from './store.js';
```

with:

```ts
import type { CourseMemory, Step } from './memory.js';
```

Replace every remaining `SessionState` in the file with `CourseMemory` (three occurrences: the `assertRevisable` parameter, the `AdvanceResult.state` field, and the `advance` parameter).

Then, in `done()` inside `advance`, drop the dead `history` field:

```ts
  const done = (produced: Produced): AdvanceResult => ({
    state: { ...state, step: to, awaitingApproval: true, history: [...state.history, to] },
    produced,
  });
```

becomes:

```ts
  const done = (produced: Produced): AdvanceResult => ({
    state: { ...state, step: to, awaitingApproval: true },
    produced,
  });
```

`STEP_ORDER` must stay exported — `reconcile.ts` imports it.

- [ ] **Step 2: Retarget `ledger.ts`**

Replace the import at `src/session/ledger.ts:3`:

```ts
import type { SessionState } from './store.js';
```

with:

```ts
import type { CourseMemory } from './memory.js';
```

Replace both `SessionState` annotations (`renderLedger`, `renderGate`) with `CourseMemory`. No logic changes — `renderGate` reads `env`, `businessName`, `step` and `courseId`, all of which survive.

- [ ] **Step 3: Retarget `server.ts`**

Replace the import at `src/server.ts:5`:

```ts
import { SessionStore } from './session/store.js';
```

with:

```ts
import { CourseMemoryStore } from './session/memory.js';
```

Change `Runtime.store`'s type to `CourseMemoryStore`, and `createRuntime`'s `store: new SessionStore()` to `store: new CourseMemoryStore()`.

- [ ] **Step 4: Update `machine.test.ts`**

Run: `cd plugins/tangible-pbl && npx vitest run test/machine.test.ts`
Expected: FAIL — the fixture still imports `SessionState` from `../src/session/store.js` and sets `history`.

Change the import to `import type { CourseMemory } from '../src/session/memory.js';`, rename the type in the fixture factory, delete `history: []` and `businessId: 'b1'` from it, and add `title: 'Intro'`, `status: 'active'`, `created: '2026-08-05T10:00:00.000Z'`, `updated: '2026-08-05T10:00:00.000Z'`. Delete any assertion that reads `history`.

- [ ] **Step 5: Typecheck**

Run: `cd plugins/tangible-pbl && npx tsc --noEmit`
Expected: errors only in `src/tools/session.ts` and `test/store.test.ts`, which Task 6 replaces. Every other file must be clean. If `machine.ts`, `ledger.ts` or `server.ts` still error, fix them before continuing.

- [ ] **Step 6: Confirm the advance-once invariant still holds**

Run: `cd plugins/tangible-pbl && npx vitest run test/machine.test.ts`
Expected: PASS. This is the suite that enforces `advance()` moving exactly one step; it must be green before the tools layer is touched.

- [ ] **Step 7: Commit**

```bash
cd plugins/tangible-pbl && npm run build && cd ../..
git add plugins/tangible-pbl/src/session/machine.ts plugins/tangible-pbl/src/session/ledger.ts plugins/tangible-pbl/src/server.ts plugins/tangible-pbl/test/machine.test.ts plugins/tangible-pbl/dist
git commit -m "refactor(tangible-pbl): type the machine and ledger against course memory"
```

Note: `npm run build` may fail here because `src/tools/session.ts` is not yet migrated. If so, commit without `dist/` and note that Task 6 restores it — the dist gate only runs in CI, and Task 6 lands before any push.

---

### Task 6: Migrate the tools layer and add `pbl_resume`

**Files:**
- Modify: `plugins/tangible-pbl/src/tools/session.ts`
- Delete: `plugins/tangible-pbl/src/session/store.ts`
- Delete: `plugins/tangible-pbl/test/store.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5, plus `listContentUnits` from `../api/builder.js` and `resolveBusiness` from `../resolve.js`.
- Produces: 14 registered tools — the existing 13 plus `pbl_resume`.

- [ ] **Step 1: Rewrite `pbl_start_course`'s state construction**

In `src/tools/session.ts`, change the import of `SessionState`/`Step`:

```ts
import type { SessionState, Step } from '../session/store.js';
```

to:

```ts
import type { CourseMemory, LogEntry, Step } from '../session/memory.js';
```

Add to the `../api/builder.js` import list: `listContentUnits`. Add a new import: `import { resolveBusiness } from '../resolve.js';` and `import { reconcile, renderResume } from '../session/reconcile.js';`.

Replace the `const state: SessionState = {…}` block and the `randomUUID` id with slug allocation:

```ts
      const now = new Date().toISOString();
      const id = await current.store.allocateSlug(current.env, course.title, brief);
      const state: CourseMemory = {
        id,
        title: course.title ?? brief.trim().split(/\s+/).slice(0, 8).join(' '),
        env: current.env,
        courseId: course.id,
        businessName: ctx.businessName,
        brief,
        sourceUrl,
        step: 'context',
        awaitingApproval: true,
        status: 'active',
        created: now,
        updated: now,
      };
      await current.store.save(state);
```

Delete the now-unused `randomUUID` import at the top of the file.

- [ ] **Step 2: Write a log entry on approve**

In `pbl_approve`, replace `await current.store.save(next);` with:

```ts
      const entry: LogEntry = {
        step: next.step,
        action: 'approved',
        detail: describeProduced(produced),
      };
      await current.store.save(next, entry);
```

Add this helper above `registerSessionTools`:

```ts
/** One line per gate, recording what was chosen — never the full candidate list. */
const describeProduced = (produced: Produced): string => {
  switch (produced.kind) {
    case 'skills': {
      const kept = produced.skills.filter((s) => s.isSelected);
      return `Kept ${kept.length} of ${produced.skills.length} skills: ` +
        `${kept.map((s) => s.CoreCompetencyModel.name).join(', ') || '(none)'}`;
    }
    case 'problems':
      return `Generated ${produced.problems.length} problem scenarios.`;
    case 'outline':
      return `Outline: ${produced.units.map((u) => u.title).join(', ') || '(empty)'}`;
    case 'published':
      return 'Course published.';
    case 'invited':
      return `Invited ${produced.count} learner${produced.count === 1 ? '' : 's'}.`;
    case 'none':
      return 'Advanced with nothing generated.';
  }
};
```

Add `type Produced` to the existing `../session/machine.js` import.

- [ ] **Step 3: Write a log entry on revise, carrying the reason**

Add a `reason` parameter to `pbl_revise`'s zod schema, after `step`:

```ts
      reason: z.string().optional().describe('Why this step is being redone — recorded in the course log'),
```

Destructure it (`async ({ sessionId, step, contexts, reason, ...input }, extra)`) and replace `await current.store.save(next);` with:

```ts
      const added = (contexts ?? []).map((c) => `${c.category}="${c.value}"`).join('; ');
      await current.store.save(next, {
        step: step as Step,
        action: 'revised',
        detail: [
          reason ?? 'No reason given.',
          added ? `Added contexts: ${added}` : '',
          describeProduced(produced),
        ].filter(Boolean).join('\n'),
      });
```

- [ ] **Step 4: Make `pbl_abort` close rather than delete**

Replace the `pbl_abort` handler body with:

```ts
    async ({ sessionId }) => {
      const current = rt.current;
      const state = await current.store.load(current.env, sessionId);
      await current.store.save({ ...state, status: 'closed' }, {
        step: state.step,
        action: 'closed',
        detail: 'Session closed. The course was not deleted.',
      });
      if (current.activeSessionId === sessionId) current.activeSessionId = undefined;
      return text(
        `Closed "${state.title}". The course was not deleted, and the record stays ` +
          `in pbl_status.`,
      );
    },
```

- [ ] **Step 5: Show status in the `pbl_status` listing**

In `pbl_status`, replace the list-rendering line:

```ts
            : all.map((s) => `${s.id} · ${s.businessName} · ${renderLedger(s)}`).join('\n'),
```

with:

```ts
            : all
                .map((s) => `${s.id} · ${s.status} · ${s.businessName} · ${renderLedger(s)}`)
                .join('\n'),
```

and change the empty-list message from `No open sessions in ${current.env}.` to `No courses in ${current.env}.`

- [ ] **Step 6: Add `pbl_resume`**

Add this tool registration after `pbl_status`:

```ts
  server.tool(
    'pbl_resume',
    'Reopen a course by name, re-resolve its business, and report anything that ' +
      'changed in the web app since. Never overwrites the backend.',
    { course: z.string().describe('The course slug, as shown by pbl_status') },
    async ({ course: slug }) => {
      const current = rt.current;
      const memory = await current.store.load(current.env, slug);

      // businessId is deliberately not persisted — re-resolving by name keeps a
      // UUID out of a file a human reads and makes the memory machine-portable.
      const business = await resolveBusiness(current.http, current.auth, memory.businessName);
      await current.auth.useBusiness(business.id, business.name);

      const course = await getCourse(current.http, current.auth, memory.courseId);
      const units = await listContentUnits(current.http, current.auth, memory.courseId);
      current.activeSessionId = memory.id;

      return text(renderResume(memory, course, units, reconcile(memory, course, units)));
    },
  );
```

Check `src/auth.ts` for the exact name of the method that sets business context (the one `pbl_use_business` calls) and use that name rather than `useBusiness` if it differs.

- [ ] **Step 7: Delete the superseded files**

```bash
git rm plugins/tangible-pbl/src/session/store.ts plugins/tangible-pbl/test/store.test.ts
```

- [ ] **Step 8: Typecheck and run the whole suite**

Run: `cd plugins/tangible-pbl && npx tsc --noEmit && npm test`
Expected: PASS, clean typecheck, no reference to `session/store.js` anywhere.

Run: `cd plugins/tangible-pbl && grep -rn "session/store" src test; echo "exit=$?"`
Expected: `exit=1` — no matches.

- [ ] **Step 9: Verify the server reports 14 tools**

Run:
```bash
cd plugins/tangible-pbl && npm run build && \
TANGIBLE_ENV=staging \
TANGIBLE_STAGING_API_URL=https://example.test/v1 \
TANGIBLE_STAGING_APP_URL=https://example.test \
TANGIBLE_STAGING_EMAIL=a@b.test \
TANGIBLE_STAGING_PASSWORD=x \
node -e '
const { spawn } = require("child_process");
const p = spawn("node", ["dist/index.js"], { stdio: ["pipe","pipe","inherit"], env: process.env });
let buf = "";
p.stdout.on("data", (d) => {
  buf += d;
  for (const line of buf.split("\n").slice(0, -1)) {
    const m = JSON.parse(line);
    if (m.id === 1) p.stdin.write(JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/list"}) + "\n");
    if (m.id === 2) { console.log("tools:", m.result.tools.length, m.result.tools.map(t=>t.name).join(",")); p.kill(); }
  }
  buf = buf.slice(buf.lastIndexOf("\n") + 1);
});
p.stdin.write(JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"t",version:"0"}}}) + "\n");
'
```
Expected: `tools: 14` with `pbl_resume` in the list.

- [ ] **Step 10: Commit**

```bash
cd plugins/tangible-pbl && npm run build && cd ../..
git add -A plugins/tangible-pbl
git commit -m "feat(tangible-pbl): log gate decisions to course memory and add pbl_resume"
```

---

### Task 7: Documentation and release

**Files:**
- Modify: `plugins/tangible-pbl/CLAUDE.md`
- Modify: `plugins/tangible-pbl/README.md`

**Interfaces:**
- Consumes: the finished implementation.
- Produces: no code.

- [ ] **Step 1: Update `CLAUDE.md`**

Three edits, all in `plugins/tangible-pbl/CLAUDE.md`:

1. In "Known limitations and deferred work", delete the bullet reading "`SessionState.businessId` / `brief` / `sourceUrl` / `history` are persisted and never read. `history` should at minimum be `Step[]`." — `businessId` and `history` are gone, and `brief` and `sourceUrl` are now read on resume.
2. In "Working here", change "npm test # vitest run, 111 tests" to the count `npm test` actually reports.
3. Add to "Non-negotiables":

```markdown
**Course memory is append-only.** `CourseMemoryStore.save` rewrites the
frontmatter and inserts at most one log entry; every other byte of the body —
including hand-written `## Notes` and every earlier entry — passes through
verbatim. A revise appends a second entry rather than editing the first. Tests
in `test/memory.test.ts` pin this. There is no `delete`: `pbl_abort` sets
`status: closed`, and removing a record is the user's to do with `rm`.
```

- [ ] **Step 2: Update `README.md`**

Document `pbl_resume` alongside the other tools, and replace any statement that `pbl_abort` deletes the session with the closing behaviour. Update the tool count if the README states one.

- [ ] **Step 3: Verify the docs match reality**

Run: `cd plugins/tangible-pbl && npm test 2>&1 | tail -5`
Expected: the test count printed here matches the number now written in `CLAUDE.md`.

Run: `grep -rn "history\|businessId" plugins/tangible-pbl/src plugins/tangible-pbl/CLAUDE.md`
Expected: no hits describing persisted session fields. Hits inside `resolve.ts` (`m.businessId` from the API payload) are expected and correct — that is the API's own field name, not a persisted one.

- [ ] **Step 4: Full verification before commit**

Run: `cd plugins/tangible-pbl && npx tsc --noEmit && npm test && npm run build && cd ../.. && git diff --exit-code -- plugins/tangible-pbl/dist; echo "dist-clean=$?"`
Expected: typecheck clean, all tests pass, `dist-clean=0`.

Run: `node scripts/validate.mjs`
Expected: PASS — 5 plugins, 3 warnings.

- [ ] **Step 5: Commit**

```bash
git add plugins/tangible-pbl/CLAUDE.md plugins/tangible-pbl/README.md
git commit -m "docs(tangible-pbl): document course memory and pbl_resume"
```

- [ ] **Step 6: Note on versioning — do not bump by hand**

The release automation now owns version numbers. The `feat(tangible-pbl):` commits in this plan will make release-please open a minor-bump release pull request once this branch reaches `main`. Do not edit `package.json`, `.claude-plugin/plugin.json` or `marketplace.json` — `scripts/validate.mjs` will fail the build if you do.

---

## Verification against the spec

Mapping each of the spec's nine verification points to where it is proven:

| Spec point | Proven by |
|---|---|
| 1. Abort leaves a readable file; `pbl_status` lists it as closed | Task 3 "lists only the requested environment, including closed courses"; Task 6 Steps 4–5 |
| 2. Colon and double quote round-trip | Task 1 "round-trips a value containing a colon and a double quote" |
| 3. Hand-written Notes and earlier entries survive byte-for-byte | Task 3 "preserves hand-written Notes text and earlier entries byte-for-byte" |
| 4. No `.tmp` file remains | Task 3 "leaves no .tmp file behind" |
| 5. Colliding slug becomes `-2` | Task 3 "allocates a colliding slug as -2, then -3" |
| 6. `../` rejected by `assertSafeId` | Task 3 three traversal tests + Step 6 breakage proof |
| 7. Resume reports difference without overwriting | Task 4 reconcile tests; `reconcile` returns data and performs no writes |
| 8. Resume re-resolves business by name, no `businessId` in the file | Task 6 Step 6; Task 1 `serializeFrontmatter` has no `businessId` key |
| 9. Each test verified by breaking the code | Task 1 Step 5, Task 3 Steps 5–6, Task 4 Step 5 |
