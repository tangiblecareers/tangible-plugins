import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
/**
 * Flat `key: value` only, values JSON-encoded. A real YAML parser would be a
 * new dependency for a format we fully control, and JSON encoding is what lets
 * colons, quotes and unicode round-trip without escaping rules of our own.
 * Anything free-form (the brief, rationale) lives in the body, where it cannot
 * break parsing.
 */
export const serializeFrontmatter = (m) => {
    const pairs = [
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
    if (m.sourceUrl)
        pairs.push(['sourceUrl', m.sourceUrl]);
    return ['---', ...pairs.map(([k, v]) => `${k}: ${JSON.stringify(v)}`), '---'].join('\n');
};
const FRONT_RE = /^---\n([\s\S]*?)\n---/;
const PAIR_RE = /^([A-Za-z][A-Za-z0-9_]*): (.*)$/;
export const parseFrontmatter = (text, file) => {
    const m = FRONT_RE.exec(text);
    if (!m) {
        throw new Error(`${file}: no frontmatter block — the file must start with a "---" fenced block.`);
    }
    const out = {};
    const lines = m[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '')
            continue;
        // +2: line 1 is the opening "---", so body line i is file line i + 2.
        const at = `${file}:${i + 2}`;
        const kv = PAIR_RE.exec(line);
        if (!kv)
            throw new Error(`${at}: expected "key: value", got ${JSON.stringify(line)}`);
        try {
            out[kv[1]] = JSON.parse(kv[2]);
        }
        catch {
            throw new Error(`${at}: value for "${kv[1]}" is not valid JSON — got ${JSON.stringify(kv[2])}`);
        }
    }
    return out;
};
export const splitDocument = (text, file) => {
    const front = parseFrontmatter(text, file);
    const m = FRONT_RE.exec(text);
    return { front, body: text.slice(m[0].length).replace(/^\n+/, '') };
};
const kebab = (s) => s
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
export const slugify = (title, brief) => kebab(title ?? '') ||
    kebab(brief.trim().split(/\s+/).slice(0, 5).join(' ')) ||
    'course';
const assertSafeId = (id) => {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
        throw new Error(`Invalid course id "${id}".`);
    }
    return id;
};
// Kept as literal arrays here — alongside the Step and CourseStatusLabel
// definitions they enumerate — rather than importing STEP_ORDER from
// machine.ts, which would make memory.ts depend on the module that already
// depends on memory.ts for these very types. Keep in sync with machine.ts's
// STEP_ORDER by hand if a step is ever added or renamed.
const STEPS = [
    'context', 'skills', 'problems', 'outline', 'detail', 'publish', 'invite', 'done',
];
const STATUS_LABELS = ['active', 'closed', 'published'];
/**
 * A hand-edited or corrupted `step`/`status` value is not a parse failure in
 * the JSON sense — `JSON.parse('"bogus"')` succeeds — so it would otherwise
 * flow through as an unchecked cast. `front.step as Step` on a dropped or
 * renamed key silently yields `undefined`, `STEP_ORDER.indexOf(undefined)` is
 * `-1`, and `nextStep` returns `'done'` — a hand-edit would silently persist
 * `step: "done"` on the next pbl_approve, real state loss in a feature whose
 * whole point is durability. Validating here, at load time, turns that into a
 * loud failure naming the offending key and value instead.
 */
const assertOneOf = (value, valid, key, file) => {
    if (typeof value === 'string' && valid.includes(value)) {
        return value;
    }
    throw new Error(`${file}: invalid "${key}" — expected one of ${valid.join(', ')}, got ${JSON.stringify(value)}`);
};
const NOTES = '## Notes';
// The document's headings always appear in this fixed order (see freshBody).
// A section's content is free-form text that may itself contain a line
// starting with "## " — e.g. a brief pasted with markdown in it — so the
// boundary must be the *specific* next known heading, not the first "## "
// found after the start, or embedded text would truncate the extraction.
// `section()` is only correct for headings listed here — any heading absent
// from this map extracts to end-of-document instead of stopping at its real
// successor. Only 'Brief' is ever extracted today; add an entry here before
// adding a second caller for a different heading.
const NEXT_HEADING = { Brief: 'Log' };
const section = (body, heading) => {
    const start = body.indexOf(`## ${heading}\n`);
    if (start === -1)
        return '';
    const from = start + `## ${heading}\n`.length;
    const after = NEXT_HEADING[heading];
    const next = after ? body.indexOf(`\n## ${after}`, from) : -1;
    return body.slice(from, next === -1 ? undefined : next + 1).trim();
};
const hhmm = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
export const renderEntry = (e, at) => `### ${hhmm(at)} · ${e.step} — ${e.action}\n${e.detail}\n`;
// The stored brief is trimmed so the round-trip is stable: section() also
// trims on read, and trimming only on read (not on write) would mean a brief
// saved with surrounding whitespace comes back different from what a second
// save/load cycle of that same loaded value would produce. Trimming here
// makes section()'s trim idempotent instead of lossy.
const freshBody = (m) => [
    `# ${m.title}`,
    `${m.env} · ${m.businessName}`,
    '',
    '## Brief',
    m.brief.trim(),
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
 *
 * Anchors on the LAST "## Notes", not the first: pbl_start_course's own
 * description tells the user to paste the full source document as the brief,
 * so a brief that itself contains a "## Notes" heading is realistic. The
 * tool always writes the real "## Notes" heading last (see freshBody), so
 * indexOf would find a brief's heading first and insert the entry inside the
 * Brief section, leaving the real Log section empty. lastIndexOf always finds
 * the real one regardless of what the brief contains.
 */
const insertEntry = (body, rendered) => {
    const at = body.lastIndexOf(NOTES);
    if (at === -1)
        return `${body.replace(/\n*$/, '')}\n\n${rendered}`;
    return `${body.slice(0, at)}${rendered}\n${body.slice(at)}`;
};
// Per-call-unique so two concurrent saves of the same course never write the
// same .tmp path — otherwise the second writeFile can clobber the first's
// tmp before its rename, and one of the two renames then fails ENOENT.
let tmpSeq = 0;
export class CourseMemoryStore {
    root;
    now;
    constructor(root = join(homedir(), '.tangible-pbl-mcp', 'courses'), now = () => new Date()) {
        this.root = root;
        this.now = now;
    }
    #dir(env) {
        return join(this.root, env);
    }
    #file(env, id) {
        return join(this.#dir(env), `${assertSafeId(id)}.md`);
    }
    async save(m, entry) {
        const file = this.#file(m.env, m.id);
        await mkdir(this.#dir(m.env), { recursive: true });
        // "File does not exist" is the only condition that means "start fresh".
        // Reading and parsing are kept as separate steps so a malformed
        // frontmatter block (a real, recoverable failure) can never be conflated
        // with ENOENT and silently regenerated into freshBody — that would
        // discard every prior log entry and any hand-typed Notes, exactly the
        // data loss the append-only guarantee exists to prevent.
        let existing;
        try {
            existing = await readFile(file, 'utf8');
        }
        catch (err) {
            if (err.code !== 'ENOENT')
                throw err;
        }
        let body = existing === undefined ? freshBody(m) : splitDocument(existing, file).body;
        if (entry)
            body = insertEntry(body, renderEntry(entry, this.now()));
        // The store — not the caller — owns `updated`: it is the only place that
        // knows a write actually happened. pbl_approve, pbl_revise and pbl_abort
        // (Task 6) all save a state spread from the previous one, so if the
        // caller controlled this field nothing would ever advance it and every
        // one of those four call sites would have to remember to bump it itself.
        const next = { ...m, updated: this.now().toISOString() };
        const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`;
        await writeFile(tmp, `${serializeFrontmatter(next)}\n\n${body}`, 'utf8');
        // rename() is atomic on POSIX: a crash leaves either the previous file or
        // the complete new one, never a torn write.
        await rename(tmp, file);
    }
    async load(env, id) {
        const file = this.#file(env, id);
        let text;
        try {
            text = await readFile(file, 'utf8');
        }
        catch {
            throw new Error(`No course "${id}" in ${env}. Run pbl_status to see what is here.`);
        }
        return this.#parse(text, file, id, env);
    }
    #parse(text, file, id, env) {
        const { front, body } = splitDocument(text, file);
        return {
            id,
            title: String(front.course ?? id),
            env,
            courseId: String(front.courseId ?? ''),
            businessName: String(front.business ?? ''),
            brief: section(body, 'Brief'),
            ...(front.sourceUrl ? { sourceUrl: String(front.sourceUrl) } : {}),
            step: assertOneOf(front.step, STEPS, 'step', file),
            awaitingApproval: front.awaitingApproval === true,
            status: assertOneOf(front.status, STATUS_LABELS, 'status', file),
            created: String(front.created ?? ''),
            updated: String(front.updated ?? ''),
        };
    }
    async list(env) {
        let names;
        try {
            names = await readdir(this.#dir(env));
        }
        catch {
            return [];
        }
        const out = [];
        for (const n of names.filter((n) => n.endsWith('.md'))) {
            const file = join(this.#dir(env), n);
            try {
                out.push(this.#parse(await readFile(file, 'utf8'), file, n.slice(0, -3), env));
            }
            catch {
                // Skip an unreadable file rather than failing the whole listing.
            }
        }
        return out;
    }
    async allocateSlug(env, title, brief) {
        const base = slugify(title, brief);
        let taken;
        try {
            taken = await readdir(this.#dir(env));
        }
        catch {
            return base;
        }
        const has = (s) => taken.includes(`${s}.md`);
        if (!has(base))
            return base;
        for (let n = 2;; n++) {
            if (!has(`${base}-${n}`))
                return `${base}-${n}`;
        }
    }
}
