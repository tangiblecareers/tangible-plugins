import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  serializeFrontmatter, parseFrontmatter, splitDocument, slugify,
  CourseMemoryStore, type CourseMemory, type LogEntry,
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
    expect(loaded).toEqual({ ...memory(), updated: at.toISOString() });
  });

  it('round-trips a brief containing markdown headings and colons', async () => {
    const brief = 'Line one: with colon\n\n## Not a real section\n\nmore text';
    await store.save(memory({ brief }));
    expect((await store.load('staging', 'intro-to-systems-thinking')).brief).toBe(brief);
  });

  it('normalizes a brief with surrounding whitespace so the stored document is stable', async () => {
    // section() already trims on *read*, so load().brief comes back trimmed
    // regardless of what freshBody wrote — that alone can't distinguish
    // whether the write side normalizes. And once the file exists, save()
    // never re-derives the body from m.brief (only a brand-new file goes
    // through freshBody), so a second load().brief is trivially identical to
    // the first either way. The only place freshBody's own trim is
    // observable is the raw bytes written on the very first save — assert
    // those directly, or this test cannot fail.
    const brief = '\n\n  Line one\nLine two  \n\n';
    await store.save(memory({ brief }));
    const file = join(root, 'staging', 'intro-to-systems-thinking.md');
    const onceText = await readFile(file, 'utf8');
    expect(onceText).toContain('## Brief\nLine one\nLine two\n\n## Log');

    const once = await store.load('staging', 'intro-to-systems-thinking');
    expect(once.brief).toBe(brief.trim());

    // A second save/load cycle of the already-loaded value is stable: the
    // stored Brief text does not drift on repeated round-tripping.
    await store.save(once);
    const twice = await store.load('staging', 'intro-to-systems-thinking');
    expect(twice.brief).toBe(once.brief);
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

  it('rejects load when the frontmatter "step" value is not a real step', async () => {
    await store.save(memory());
    const file = join(root, 'staging', 'intro-to-systems-thinking.md');
    const corrupted = (await readFile(file, 'utf8')).replace(
      'step: "context"', 'step: "not-a-real-step"',
    );
    await writeFile(file, corrupted, 'utf8');
    await expect(store.load('staging', 'intro-to-systems-thinking')).rejects.toThrow(
      /invalid "step".*not-a-real-step/s,
    );
  });

  it('rejects load when the frontmatter "step" line is deleted entirely', async () => {
    await store.save(memory());
    const file = join(root, 'staging', 'intro-to-systems-thinking.md');
    const corrupted = (await readFile(file, 'utf8'))
      .split('\n')
      .filter((l) => !l.startsWith('step:'))
      .join('\n');
    await writeFile(file, corrupted, 'utf8');
    await expect(store.load('staging', 'intro-to-systems-thinking')).rejects.toThrow(
      /invalid "step"/,
    );
  });

  it('skips a file with a bogus "step" value in list() rather than throwing', async () => {
    await store.save(memory());
    const file = join(root, 'staging', 'intro-to-systems-thinking.md');
    const corrupted = (await readFile(file, 'utf8')).replace(
      'step: "context"', 'step: "not-a-real-step"',
    );
    await writeFile(file, corrupted, 'utf8');
    await store.save(memory({ id: 'second' }));

    const ids = (await store.list('staging')).map((m) => m.id);
    expect(ids).toEqual(['second']);
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

  it('anchors the inserted entry on the real (last) "## Notes" heading, even when the brief itself contains one', async () => {
    // pbl_start_course's own description tells the user to paste the full
    // source document as the brief, so a source doc containing a "## Notes"
    // heading is realistic. The real "## Notes" heading (written by
    // freshBody) is always the LAST one in the document — insertEntry must
    // anchor there, not on the brief's embedded one, or the entry lands
    // inside the Brief section and the real Log section stays empty.
    const brief = 'Some brief text.\n\n## Notes\nThis line is part of the brief, not the real Notes section.';
    await store.save(memory({ brief }));
    await store.save(memory({ brief }), entry());

    const file = join(root, 'staging', 'intro-to-systems-thinking.md');
    const text = await readFile(file, 'utf8');

    const logHeadingIdx = text.indexOf('## Log');
    const entryIdx = text.indexOf('### 10:12 · skills — approved');
    const lastNotesIdx = text.lastIndexOf('## Notes');

    expect(logHeadingIdx).toBeGreaterThanOrEqual(0);
    expect(entryIdx).toBeGreaterThan(logHeadingIdx);
    expect(entryIdx).toBeLessThan(lastNotesIdx);

    // The brief itself must come back unchanged — not the brief plus the log.
    expect((await store.load('staging', 'intro-to-systems-thinking')).brief).toBe(brief);
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

  it('rejects a save over corrupt frontmatter and leaves the file untouched', async () => {
    await store.save(memory()); // ensures the staging directory exists
    const file = join(root, 'staging', 'intro-to-systems-thinking.md');
    const corrupt = [
      '---',
      'course: not-json',
      '---',
      '',
      '## Log',
      '',
      '### 09:00 · context — approved',
      'a prior entry that must survive',
      '',
      '## Notes',
      'someone\'s hand-written note',
      '',
    ].join('\n');
    await writeFile(file, corrupt, 'utf8');

    await expect(store.save(memory())).rejects.toThrow(/not valid JSON/);

    // The point: save() must not have regenerated the file from freshBody(m)
    // when parsing failed — the original bytes, prior entry and hand-written
    // note included, must still be there, untouched.
    expect(await readFile(file, 'utf8')).toBe(corrupt);
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

/**
 * Regression: a live staging run wrote `courseId: undefined` into the
 * frontmatter and permanently bricked the file — every subsequent read threw
 * `value for "courseId" is not valid JSON — got "undefined"`, including the
 * pbl_abort that would have cleaned it up.
 *
 * Mechanism: JSON.stringify(undefined) returns undefined (the value, not a
 * string), so `${k}: ${JSON.stringify(v)}` interpolated the bare text
 * `undefined`. Every fixture in this file had all fields defined, so no test
 * could reach the failure path.
 */
describe('serializeFrontmatter — refuses to write an unreadable file', () => {
  const REQUIRED: [keyof CourseMemory, string][] = [
    ['title', 'course'],
    ['env', 'env'],
    ['courseId', 'courseId'],
    ['businessName', 'business'],
    ['step', 'step'],
    ['status', 'status'],
    ['created', 'created'],
    ['updated', 'updated'],
  ];

  it.each(REQUIRED)('throws naming the frontmatter key when %s is undefined', (field, key) => {
    const broken = { ...memory(), [field]: undefined } as unknown as CourseMemory;
    expect(() => serializeFrontmatter(broken)).toThrow(new RegExp(`"${key}"`));
  });

  it('checks for undefined, not falsiness — awaitingApproval: false still writes', () => {
    // A `if (!v) throw` guard would reject false and empty strings. Both are
    // legitimate values that must round-trip.
    const text = serializeFrontmatter(memory({ awaitingApproval: false, title: '' }));
    expect(text).toContain('awaitingApproval: false');
    expect(text).toContain('course: ""');
  });

  it('leaves nothing on disk when save refuses', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pbl-undef-'));
    const store = new CourseMemoryStore(root);
    const broken = { ...memory(), courseId: undefined } as unknown as CourseMemory;

    await expect(store.save(broken)).rejects.toThrow(/"courseId"/);

    // The point of the guard: a bad memory must never reach the filesystem, so
    // there is no bricked file and no stray .tmp to clean up afterwards.
    const names = await readdir(join(root, 'staging')).catch(() => []);
    expect(names).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });
});
