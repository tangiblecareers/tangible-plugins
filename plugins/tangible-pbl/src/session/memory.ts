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
