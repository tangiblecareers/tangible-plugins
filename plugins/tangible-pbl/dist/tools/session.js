import { z } from 'zod';
import { createCourse, generateContentUnits, generateProblems, generateSkills, getCourse, listContentUnits, selectContext, selectProblem, selectSkill, addContext, } from '../api/builder.js';
import { publishCourse, sendInvitations } from '../api/courses.js';
import { advance, assertRevisable } from '../session/machine.js';
import { renderGate, renderLedger } from '../session/ledger.js';
import { reconcile, renderResume } from '../session/reconcile.js';
import { resolveBusiness } from '../resolve.js';
import { text } from './render.js';
const makeOnProgress = (extra) => (message) => {
    const progressToken = extra?._meta?.progressToken;
    if (progressToken === undefined)
        return;
    void extra.sendNotification?.({
        method: 'notifications/progress',
        params: { progressToken, message, progress: 0, total: 0 },
    });
};
/**
 * Adds each context item and selects it, so it counts toward the next skills
 * generation. course-contexts are created un-selected (see
 * business-course-context.api.yaml); course-skills/generate 422s without at
 * least one selected context. Used by both pbl_start_course and pbl_revise —
 * shared here so the "add then select" contract can't drift between them.
 *
 * The API doesn't return the created item's id directly, and a duplicate
 * (category, value) pair is possible (nothing stops two identical values
 * from existing unselected at once), so category+value alone can't reliably
 * identify the one just created. Instead each addContext response is diffed
 * against the set of context ids known before that call — the id that
 * wasn't there before is unambiguously the new one, regardless of whether
 * its category/value duplicates an existing entry.
 */
const applyContexts = async (http, auth, courseId, contexts, initialContexts) => {
    if (contexts.length === 0)
        return;
    const seed = initialContexts ?? (await getCourse(http, auth, courseId)).CourseContexts ?? [];
    const known = new Set(seed.map((c) => c.id));
    for (const c of contexts) {
        const course = await addContext(http, auth, courseId, c.category, c.value);
        const all = course.CourseContexts ?? [];
        const created = all.find((cc) => !known.has(cc.id));
        for (const cc of all)
            known.add(cc.id);
        if (!created) {
            throw new Error(`addContext for ${c.category} "${c.value}" did not return the new context in ` +
                'CourseContexts — cannot identify which one to select. Aborting rather than ' +
                'guessing and selecting the wrong context.');
        }
        await selectContext(http, auth, courseId, created.id, true);
    }
};
const depsFor = (rt, onProgress) => ({
    generateSkills: (id) => generateSkills(rt.http, rt.auth, id),
    generateProblems: (id) => generateProblems(rt.http, rt.auth, id),
    generateContentUnits: (id) => generateContentUnits(rt.http, rt.auth, id),
    getCourse: (id) => getCourse(rt.http, rt.auth, id),
    selectSkill: (id, sid, on) => selectSkill(rt.http, rt.auth, id, sid, on),
    selectProblem: (id, pid, on) => selectProblem(rt.http, rt.auth, id, pid, on),
    publish: (id) => publishCourse(rt.http, rt.auth, id),
    invite: (id, emails) => sendInvitations(rt.http, rt.auth, id, emails),
    onProgress,
});
/**
 * One line per gate, recording what the backend produced — never the full
 * candidate list. This describes generation output, not a human decision: the
 * 'skills' case in particular runs immediately after generateSkills(), before
 * any human has touched the selection, so it must not claim anything was
 * "kept" — that claim belongs in the caller's decision line (see
 * describeApprovalInput below), built from the *next* call's selectSkills
 * input, not from this one.
 */
const describeProduced = (produced) => {
    switch (produced.kind) {
        case 'skills': {
            const recommended = produced.skills.filter((s) => s.isSelected).length;
            return `Generated ${produced.skills.length} skills, ${recommended} AI-recommended.`;
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
/**
 * The action recorded for a pbl_approve call. Most advances are just
 * "approved", but produced.kind already tells us precisely when the human
 * decision was to publish or to invite learners — LogEntry's action enum
 * exists to capture exactly that distinction, so it is derived here rather
 * than hardcoded to 'approved' regardless of what the gate actually did.
 * Written as an exhaustive switch (no default) so a seventh Produced variant
 * is a compile error here, the same safety describeProduced already has.
 */
const actionFor = (produced) => {
    switch (produced.kind) {
        case 'published': return 'published';
        case 'invited': return 'invited';
        case 'skills':
        case 'problems':
        case 'outline':
        case 'none':
            return 'approved';
    }
};
/**
 * The human decision behind a pbl_approve call, derived from the *input* that
 * was passed in — not from what the backend produced. selectSkills/selectProblem
 * choose from the *previous* gate's candidates (e.g. selectSkills is passed
 * while advancing skills -> problems, to say which already-generated skills to
 * keep), so this must read `input`, not `produced`. Logs the strings the human
 * actually passed — never resolved to an id, never the full candidate list.
 */
const describeApprovalInput = (input) => {
    const lines = [];
    if (input.selectSkills?.length) {
        lines.push(`Kept skills: ${input.selectSkills.join(', ')}`);
    }
    if (input.selectProblem) {
        lines.push(`Chose problem: "${input.selectProblem}"`);
    }
    return lines;
};
export const registerSessionTools = (server, rt) => {
    server.tool('pbl_start_course', 'Create a course from a brief and stop at the first gate. Pass the full text of the source document as `brief`.', {
        brief: z.string().min(1).describe('The course brief — paste the source document text here'),
        contexts: z
            .array(z.object({
            category: z.enum(['DURATION', 'LEARNING_OUTCOME', 'LEARNER_PROFILE']),
            value: z.string(),
        }))
            .optional()
            .describe('Context items — each is created then selected automatically so skills ' +
            'generation has at least one selected context to work with (required, ' +
            'or the next pbl_approve 422s). DURATION is single-select — the last one ' +
            'wins per the course rules; LEARNING_OUTCOME and LEARNER_PROFILE accumulate.'),
        sourceUrl: z.string().url().optional().describe('Where the brief came from, kept for provenance'),
    }, async ({ brief, contexts, sourceUrl }) => {
        const current = rt.current;
        const ctx = current.auth.context();
        if (!ctx)
            throw new Error('No business selected. Call pbl_use_business first.');
        const course = await createCourse(current.http, current.auth, brief);
        // A freshly-created course has no contexts yet, so pass [] explicitly
        // rather than undefined — that skips applyContexts' getCourse fallback,
        // which exists for pbl_revise where the course may already have some.
        await applyContexts(current.http, current.auth, course.id, contexts ?? [], course.CourseContexts ?? []);
        const now = new Date().toISOString();
        const id = await current.store.allocateSlug(current.env, course.title, brief);
        const state = {
            id,
            title: course.title || brief.trim().split(/\s+/).slice(0, 8).join(' '),
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
        current.activeSessionId = state.id;
        return text(`Session ${state.id}\n` +
            renderGate(state, { appUrl: current.appUrl, produced: { kind: 'none' } }));
    });
    server.tool('pbl_status', 'Show a course’s progress, or list every course — open and closed — in this environment.', { sessionId: z.string().optional() }, async ({ sessionId }) => {
        const current = rt.current;
        if (!sessionId) {
            const all = await current.store.list(current.env);
            return text(all.length === 0
                ? `No courses in ${current.env}.`
                : all
                    .map((s) => `${s.id} · ${s.status} · ${s.businessName} · ${renderLedger(s)}`)
                    .join('\n'));
        }
        const state = await current.store.load(current.env, sessionId);
        return text(renderGate(state, { appUrl: current.appUrl, produced: { kind: 'none' } }));
    });
    server.tool('pbl_resume', 'Reopen a course by name, re-resolve its business, and report anything that ' +
        'changed in the web app since. Never overwrites the backend.', { course: z.string().describe('The course slug, as shown by pbl_status') }, async ({ course: slug }) => {
        const current = rt.current;
        const memory = await current.store.load(current.env, slug);
        // businessId is deliberately not persisted — re-resolving by name keeps a
        // UUID out of a file a human reads and makes the memory machine-portable.
        const business = await resolveBusiness(current.http, current.auth, memory.businessName);
        await current.auth.loginBusiness(business.id, business.name);
        const course = await getCourse(current.http, current.auth, memory.courseId);
        const units = await listContentUnits(current.http, current.auth, memory.courseId);
        current.activeSessionId = memory.id;
        return text(renderResume(memory, course, units, reconcile(memory, course, units)));
    });
    server.tool('pbl_approve', 'Advance the session exactly one step. This is the only way forward — nothing advances on its own.', {
        sessionId: z.string(),
        selectSkills: z.array(z.string()).optional().describe('Skill names to keep; others are deselected'),
        selectProblem: z.string().optional().describe('Problem scenario title, id, or a unique prefix of either, to select'),
        emails: z.array(z.string().email()).optional().describe('Learner emails, for the invite gate'),
    }, async ({ sessionId, ...input }, extra) => {
        const current = rt.current;
        const state = await current.store.load(current.env, sessionId);
        const onProgress = makeOnProgress(extra);
        const { state: next, produced } = await advance(depsFor(current, onProgress), state, input);
        // advance()'s done() spreads the previous state, so status never moves
        // off 'active' on its own — the publish gate is the one place a human
        // decision changes it, and reconcile() depends on this being set so a
        // later pbl_resume doesn't misreport an in-band publish as a surprise.
        const advanced = produced.kind === 'published' ? { ...next, status: 'published' } : next;
        const entry = {
            step: advanced.step,
            action: actionFor(produced),
            detail: [...describeApprovalInput(input), describeProduced(produced)].join('\n'),
        };
        await current.store.save(advanced, entry);
        return text(renderGate(advanced, { appUrl: current.appUrl, produced }));
    });
    server.tool('pbl_revise', 'Redo a step with changes — pass `contexts` to add new context items when step is ' +
        '"context". Context, skills and problems are frozen once the outline exists.', {
        sessionId: z.string(),
        step: z.enum(['context', 'skills', 'problems', 'outline']),
        contexts: z
            .array(z.object({
            category: z.enum(['DURATION', 'LEARNING_OUTCOME', 'LEARNER_PROFILE']),
            value: z.string(),
        }))
            .optional()
            .describe('New context items to add when step is "context" (ignored otherwise). Each ' +
            'is created un-selected, then selected immediately so it counts toward the ' +
            'next skills generation. Selections accumulate: LEARNING_OUTCOME and ' +
            'LEARNER_PROFILE add alongside whatever is already selected in that ' +
            'category. DURATION is single-select — adding one automatically deselects ' +
            'the previous DURATION selection (server-enforced). Omit to just ' +
            'regenerate skills against the unchanged context.'),
        selectSkills: z.array(z.string()).optional().describe('Skill names to keep; others are deselected'),
        selectProblem: z.string().optional().describe('Problem scenario title, id, or a unique prefix of either, to select'),
        reason: z.string().optional().describe('Why this step is being redone — recorded in the course log'),
    }, async ({ sessionId, step, contexts, reason, ...input }, extra) => {
        const current = rt.current;
        const state = await current.store.load(current.env, sessionId);
        assertRevisable(state, step);
        if (step === 'context') {
            await applyContexts(current.http, current.auth, state.courseId, contexts ?? []);
        }
        const onProgress = makeOnProgress(extra);
        const rewound = {
            ...state,
            step: step === 'context' ? 'context' : { skills: 'context', problems: 'skills', outline: 'problems' }[step],
            awaitingApproval: true,
        };
        const { state: next, produced } = await advance(depsFor(current, onProgress), rewound, input);
        const added = (contexts ?? []).map((c) => `${c.category}="${c.value}"`).join('; ');
        await current.store.save(next, {
            step: step,
            action: 'revised',
            detail: [
                reason ?? 'No reason given.',
                added ? `Added contexts: ${added}` : '',
                describeProduced(produced),
            ].filter(Boolean).join('\n'),
        });
        return text(renderGate(next, { appUrl: current.appUrl, produced }));
    });
    server.tool('pbl_abort', 'Close the session. The course is left exactly as it is.', { sessionId: z.string() }, async ({ sessionId }) => {
        const current = rt.current;
        const state = await current.store.load(current.env, sessionId);
        await current.store.save({ ...state, status: 'closed' }, {
            step: state.step,
            action: 'closed',
            detail: 'Session closed. The course was not deleted.',
        });
        if (current.activeSessionId === sessionId)
            current.activeSessionId = undefined;
        return text(`Closed "${state.title}". The course was not deleted, and the record stays ` +
            `in pbl_status.`);
    });
};
