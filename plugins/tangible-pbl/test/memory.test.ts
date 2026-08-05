import { describe, it, expect } from 'vitest';
import {
  serializeFrontmatter, parseFrontmatter, splitDocument, slugify,
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
