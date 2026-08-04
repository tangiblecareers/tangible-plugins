import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createCourse, generateContentUnits, generateProblems, generateSkills, getCourse, selectContext, selectProblem, selectSkill, addContext, } from '../api/builder.js';
import { publishCourse, sendInvitations } from '../api/courses.js';
import { advance, assertRevisable } from '../session/machine.js';
import { renderGate, renderLedger } from '../session/ledger.js';
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
        const state = {
            id: randomUUID().slice(0, 8),
            env: current.env,
            courseId: course.id,
            businessId: ctx.businessId,
            businessName: ctx.businessName,
            brief,
            sourceUrl,
            step: 'context',
            awaitingApproval: true,
            history: ['context'],
        };
        await current.store.save(state);
        current.activeSessionId = state.id;
        return text(`Session ${state.id}\n` +
            renderGate(state, { appUrl: current.appUrl, produced: { kind: 'none' } }));
    });
    server.tool('pbl_status', 'Show a session’s progress, or list open sessions in this environment.', { sessionId: z.string().optional() }, async ({ sessionId }) => {
        const current = rt.current;
        if (!sessionId) {
            const all = await current.store.list(current.env);
            return text(all.length === 0
                ? `No open sessions in ${current.env}.`
                : all.map((s) => `${s.id} · ${s.businessName} · ${renderLedger(s)}`).join('\n'));
        }
        const state = await current.store.load(current.env, sessionId);
        return text(renderGate(state, { appUrl: current.appUrl, produced: { kind: 'none' } }));
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
        await current.store.save(next);
        return text(renderGate(next, { appUrl: current.appUrl, produced }));
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
    }, async ({ sessionId, step, contexts, ...input }, extra) => {
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
        await current.store.save(next);
        return text(renderGate(next, { appUrl: current.appUrl, produced }));
    });
    server.tool('pbl_abort', 'Close the session. The course is left exactly as it is.', { sessionId: z.string() }, async ({ sessionId }) => {
        const current = rt.current;
        await current.store.delete(current.env, sessionId);
        if (current.activeSessionId === sessionId)
            current.activeSessionId = undefined;
        return text(`Session ${sessionId} closed. The course was not deleted.`);
    });
};
