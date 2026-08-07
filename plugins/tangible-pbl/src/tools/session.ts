import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createCourse, generateContentUnits, generateProblems, generateSkills,
  getCourse, listContentUnits, selectContext, selectProblem, selectSkill, addContext,
  type ContextCategory, type CourseContext,
} from '../api/builder.js';
import {
  createSubUnit, listSubUnits, listSubUnitSkills, assignSkill, generateArtifact,
} from '../api/subunits.js';
import { publishCourse, sendInvitations } from '../api/courses.js';
import { getCompetencyLevels } from '../api/competency.js';
import {
  advance, assertRevisable, STEP_ORDER, type ApproveInput, type Produced,
} from '../session/machine.js';
import {
  renderGate, renderLedger, renderBreakdown, renderSkills,
  type BreakdownUnit, type SkillLevelsEntry,
} from '../session/ledger.js';
import { reconcile, renderResume } from '../session/reconcile.js';
import type { CourseMemory, LogEntry, Step } from '../session/memory.js';
import { resolveBusiness } from '../resolve.js';
import type { Runtime } from '../server.js';
import type { HttpClient } from '../http.js';
import type { AuthManager } from '../auth.js';
import { text } from './render.js';

/**
 * MCP requires echoing back the token the *client* supplied in the request's
 * `_meta.progressToken` — inventing one (e.g. our own session id) causes the
 * SDK to reject the notification with "unknown token" the moment the client
 * tries to correlate it. When the client didn't ask for progress (no token
 * present), we must not send a notification at all rather than fabricate one.
 */
type ProgressCapableExtra = {
  _meta?: { progressToken?: string | number };
  sendNotification?: (notification: any) => Promise<void>;
};

const makeOnProgress = (extra: ProgressCapableExtra) => (message: string): void => {
  const progressToken = extra?._meta?.progressToken;
  if (progressToken === undefined) return;
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
const applyContexts = async (
  http: HttpClient,
  auth: AuthManager,
  courseId: string,
  contexts: { category: ContextCategory; value: string }[],
  initialContexts?: CourseContext[],
): Promise<void> => {
  if (contexts.length === 0) return;
  const seed = initialContexts ?? (await getCourse(http, auth, courseId)).CourseContexts ?? [];
  const known = new Set(seed.map((c) => c.id));
  for (const c of contexts) {
    const course = await addContext(http, auth, courseId, c.category, c.value);
    const all = course.CourseContexts ?? [];
    const created = all.find((cc) => !known.has(cc.id));
    for (const cc of all) known.add(cc.id);
    if (!created) {
      throw new Error(
        `addContext for ${c.category} "${c.value}" did not return the new context in ` +
          'CourseContexts — cannot identify which one to select. Aborting rather than ' +
          'guessing and selecting the wrong context.',
      );
    }
    await selectContext(http, auth, courseId, created.id, true);
  }
};

const depsFor = (rt: Runtime, onProgress?: (m: string) => void) => ({
  generateSkills: (id: string) => generateSkills(rt.http, rt.auth, id),
  generateProblems: (id: string) => generateProblems(rt.http, rt.auth, id),
  generateContentUnits: (id: string) => generateContentUnits(rt.http, rt.auth, id),
  getCourse: (id: string) => getCourse(rt.http, rt.auth, id),
  selectSkill: (id: string, sid: string, on: boolean) =>
    selectSkill(rt.http, rt.auth, id, sid, on),
  selectProblem: (id: string, pid: string, on: boolean) =>
    selectProblem(rt.http, rt.auth, id, pid, on),
  listContentUnits: (id: string) => listContentUnits(rt.http, rt.auth, id),
  createSubUnit: (id: string, cuId: string, values: Parameters<typeof createSubUnit>[4]) =>
    createSubUnit(rt.http, rt.auth, id, cuId, values),
  assignSkill: (id: string, cuId: string, suId: string, body: { coreCompetencyModelId: string; levelId: string }) =>
    assignSkill(rt.http, rt.auth, id, cuId, suId, body),
  getCompetencyLevels: (id: string) => getCompetencyLevels(rt.http, rt.auth, id),
  listSubUnits: (id: string, cuId: string) => listSubUnits(rt.http, rt.auth, id, cuId),
  generateArtifact: (id: string, cuId: string, suId: string, body: { instruction?: string }) =>
    generateArtifact(rt.http, rt.auth, id, cuId, suId, body),
  publish: (id: string) => publishCourse(rt.http, rt.auth, id),
  invite: (id: string, emails: string[]) => sendInvitations(rt.http, rt.auth, id, emails),
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
const describeProduced = (produced: Produced): string => {
  switch (produced.kind) {
    case 'skills': {
      const recommended = produced.skills.filter((s) => s.isSelected).length;
      return `Generated ${produced.skills.length} skills, ${recommended} AI-recommended.`;
    }
    case 'problems':
      return `Generated ${produced.problems.length} problem scenarios.`;
    case 'outline':
      return `Outline: ${produced.units.map((u) => u.title).join(', ') || '(empty)'}`;
    case 'detail':
      return produced.created.length === 0
        ? 'Created 0 sub-content units.'
        : `Created ${produced.created.length} sub-content unit${produced.created.length === 1 ? '' : 's'}: ` +
          produced.created.map((c) => `${c.contentUnitTitle} › ${c.title}`).join(', ');
    case 'artifacts':
      return `Generated ${produced.generated.length} artifact${produced.generated.length === 1 ? '' : 's'}` +
        (produced.failed.length > 0
          ? `, ${produced.failed.length} failed: ${produced.failed.map((f) => f.title).join(', ')}.`
          : '.');
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
const actionFor = (produced: Produced): LogEntry['action'] => {
  switch (produced.kind) {
    case 'published': return 'published';
    case 'invited': return 'invited';
    case 'skills':
    case 'problems':
    case 'outline':
    case 'detail':
    case 'artifacts':
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
const describeApprovalInput = (input: ApproveInput): string[] => {
  // `[]`/`''` are treated as absent here on purpose — that mirrors advance()'s
  // own `input.selectSkills?.length` and `if (!input.selectProblem)` checks,
  // so a decision line never claims a choice was made when advance() itself
  // took the "nothing given" branch.
  const lines: string[] = [];
  if (input.selectSkills?.length) {
    lines.push(`Kept skills: ${input.selectSkills.join(', ')}`);
  }
  if (input.selectProblem) {
    lines.push(`Chose problem: "${input.selectProblem}"`);
  }
  return lines;
};

export const registerSessionTools = (
  server: McpServer,
  rt: { current: Runtime },
): void => {
  server.tool(
    'pbl_start_course',
    'Create a course from a brief and stop at the first gate. Pass the full text of the source document as `brief`.',
    {
      brief: z.string().min(1).describe('The course brief — paste the source document text here'),
      contexts: z
        .array(
          z.object({
            category: z.enum(['DURATION', 'LEARNING_OUTCOME', 'LEARNER_PROFILE']),
            value: z.string(),
          }),
        )
        .optional()
        .describe(
          'Context items — each is created then selected automatically so skills ' +
            'generation has at least one selected context to work with (required, ' +
            'or the next pbl_approve 422s). DURATION is single-select — the last one ' +
            'wins per the course rules; LEARNING_OUTCOME and LEARNER_PROFILE accumulate.',
        ),
      sourceUrl: z.string().url().optional().describe('Where the brief came from, kept for provenance'),
    },
    async ({ brief, contexts, sourceUrl }) => {
      const current = rt.current;
      const ctx = current.auth.context();
      if (!ctx) throw new Error('No business selected. Call pbl_use_business first.');

      const course = await createCourse(current.http, current.auth, brief);
      // A freshly-created course has no contexts yet, so pass [] explicitly
      // rather than undefined — that skips applyContexts' getCourse fallback,
      // which exists for pbl_revise where the course may already have some.
      await applyContexts(
        current.http, current.auth, course.id, contexts ?? [], course.CourseContexts ?? [],
      );

      const now = new Date().toISOString();
      const id = await current.store.allocateSlug(current.env, course.title, brief);
      const state: CourseMemory = {
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

      return text(
        `Session ${state.id}\n` +
          renderGate(state, { appUrl: current.appUrl, produced: { kind: 'none' } }),
      );
    },
  );

  server.tool(
    'pbl_status',
    'Show a course’s progress, or list every course — open and closed — in this environment.',
    { sessionId: z.string().optional() },
    async ({ sessionId }) => {
      const current = rt.current;
      if (!sessionId) {
        const all = await current.store.list(current.env);
        return text(
          all.length === 0
            ? `No courses in ${current.env}.`
            : all
                .map((s) => `${s.id} · ${s.status} · ${s.businessName} · ${renderLedger(s)}`)
                .join('\n'),
        );
      }
      const state = await current.store.load(current.env, sessionId);

      // Only pay for the course/competency fetches once skills could exist —
      // a session still at "context" has none selected yet, and must not eat
      // the network cost of calls that only ever return nothing.
      const skillsReached =
        STEP_ORDER.indexOf(state.step) >= STEP_ORDER.indexOf('skills');
      let skillsSection = '';
      if (skillsReached) {
        const course = await getCourse(current.http, current.auth, state.courseId);
        const selected = (course.CourseSkills ?? []).filter((s) => s.isSelected);
        const entries: SkillLevelsEntry[] = [];
        for (const s of selected) {
          try {
            const levels = await getCompetencyLevels(
              current.http, current.auth, s.CoreCompetencyModel.id,
            );
            entries.push({ name: s.CoreCompetencyModel.name, levels: levels.map((l) => l.name) });
          } catch {
            // pbl_status is read-only and a partial answer beats none — one
            // failing lookup must not blank out every other skill.
            entries.push({ name: s.CoreCompetencyModel.name, levels: null });
          }
        }
        skillsSection = renderSkills(entries);
      }

      // Only pay for the content-unit/sub-unit fetches once the course could
      // possibly have any — a session still at "context" cannot, and must
      // not eat the network cost of calls that only ever return nothing.
      const detailReached =
        STEP_ORDER.indexOf(state.step) >= STEP_ORDER.indexOf('detail');
      let breakdown = '';
      if (detailReached) {
        const units = await listContentUnits(current.http, current.auth, state.courseId);
        const breakdownUnits: BreakdownUnit[] = [];
        for (const u of units) {
          const subs = await listSubUnits(current.http, current.auth, state.courseId, u.id);
          const subEntries = [];
          for (const s of subs) {
            const skills = await listSubUnitSkills(
              current.http, current.auth, state.courseId, u.id, s.id,
            );
            subEntries.push({ title: s.title, skills });
          }
          breakdownUnits.push({ title: u.title, subs: subEntries });
        }
        // Names (and, per sub-unit, skill names) only — pbl_add_resource
        // takes these, so this listing is what makes that tool reachable at
        // all, and is how an operator confirms the detail gate did what they
        // approved before running pbl_publish.
        breakdown = renderBreakdown(breakdownUnits);
      }

      return text(
        renderGate(state, { appUrl: current.appUrl, produced: { kind: 'none' } }) +
          skillsSection + breakdown,
      );
    },
  );

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
      await current.auth.loginBusiness(business.id, business.name);

      const course = await getCourse(current.http, current.auth, memory.courseId);
      const units = await listContentUnits(current.http, current.auth, memory.courseId);
      current.activeSessionId = memory.id;

      return text(renderResume(memory, course, units, reconcile(memory, course, units)));
    },
  );

  server.tool(
    'pbl_approve',
    'Advance the session exactly one step. This is the only way forward — nothing advances on its own.',
    {
      sessionId: z.string(),
      selectSkills: z.array(z.string()).optional().describe('Skill names to keep; others are deselected'),
      selectProblem: z.string().optional().describe('Problem scenario title, id, or a unique prefix of either, to select'),
      emails: z.array(z.string().email()).optional().describe('Learner emails, for the invite gate'),
      subUnits: z
        .array(
          z.object({
            contentUnit: z.string().describe('Name of the content unit this sits under'),
            title: z.string(),
            description: z.string().optional(),
            minutes: z.number().int().positive().max(60000).optional()
              .describe('Estimated duration in MINUTES'),
            skills: z.array(
              z.object({
                name: z.string().describe('Skill name, resolved against the course’s selected skills'),
                level: z.string().optional().describe(
                  'The level a learner is expected to reach in this sub-content unit, by ' +
                    'name — resolved against that skill’s competency’s own levels (never ' +
                    'CourseSkill, which carries no level). May be omitted only when the ' +
                    'competency has exactly one level, in which case that one is used ' +
                    'automatically; otherwise omitting it is an error naming the available ' +
                    'level names.',
                ),
              }),
            ).min(1).max(10)
              .describe('Skills assigned to this sub-content unit, each with the level to assign it at'),
          }),
        )
        .optional()
        .describe(
          'The sub-content-unit breakdown. Required when advancing to "detail". ' +
            'Nothing is created until this call — draft it, get agreement, then send it.',
        ),
      instruction: z.string().optional()
        .describe('Optional steer applied to every artifact at the "artifacts" gate'),
    },
    async ({ sessionId, ...input }, extra) => {
      const current = rt.current;
      const state = await current.store.load(current.env, sessionId);
      const onProgress = makeOnProgress(extra);
      const { state: next, produced } = await advance(
        depsFor(current, onProgress),
        state,
        input,
      );
      // advance()'s done() spreads the previous state, so status never moves
      // on its own. Two decisions live here: the publish gate marks the
      // memory published so reconcile() doesn't misreport an in-band publish
      // as a surprise on a later pbl_resume; and approving after resuming a
      // closed course (pbl_resume never un-closes one itself) un-closes it —
      // an approved advance is itself evidence the course is active again.
      const advanced: CourseMemory = {
        ...next,
        status:
          produced.kind === 'published' ? 'published'
          : next.status === 'closed' ? 'active'
          : next.status,
      };
      const entry: LogEntry = {
        step: advanced.step,
        action: actionFor(produced),
        detail: [...describeApprovalInput(input), describeProduced(produced)].join('\n'),
      };
      await current.store.save(advanced, entry);
      return text(renderGate(advanced, { appUrl: current.appUrl, produced }));
    },
  );

  server.tool(
    'pbl_revise',
    'Redo a step with changes — pass `contexts` to add new context items when step is ' +
      '"context". Context, skills and problems are frozen once the outline exists.',
    {
      sessionId: z.string(),
      step: z.enum(['context', 'skills', 'problems', 'outline']),
      contexts: z
        .array(
          z.object({
            category: z.enum(['DURATION', 'LEARNING_OUTCOME', 'LEARNER_PROFILE']),
            value: z.string(),
          }),
        )
        .optional()
        .describe(
          'New context items to add when step is "context" (ignored otherwise). Each ' +
            'is created un-selected, then selected immediately so it counts toward the ' +
            'next skills generation. Selections accumulate: LEARNING_OUTCOME and ' +
            'LEARNER_PROFILE add alongside whatever is already selected in that ' +
            'category. DURATION is single-select — adding one automatically deselects ' +
            'the previous DURATION selection (server-enforced). Omit to just ' +
            'regenerate skills against the unchanged context.',
        ),
      selectSkills: z.array(z.string()).optional().describe('Skill names to keep; others are deselected'),
      selectProblem: z.string().optional().describe('Problem scenario title, id, or a unique prefix of either, to select'),
      reason: z.string().optional().describe('Why this step is being redone — recorded in the course log'),
    },
    async ({ sessionId, step, contexts, reason, ...input }, extra) => {
      const current = rt.current;
      const state = await current.store.load(current.env, sessionId);
      assertRevisable(state, step as Step);

      if (step === 'context') {
        await applyContexts(current.http, current.auth, state.courseId, contexts ?? []);
      }

      const onProgress = makeOnProgress(extra);

      const rewound: CourseMemory = {
        ...state,
        step: step === 'context' ? 'context' : (
          { skills: 'context', problems: 'skills', outline: 'problems' } as const
        )[step as 'skills' | 'problems' | 'outline'],
        awaitingApproval: true,
      };
      const { state: next, produced } = await advance(depsFor(current, onProgress), rewound, input);
      const added = (contexts ?? []).map((c) => `${c.category}="${c.value}"`).join('; ');
      await current.store.save(next, {
        step: step as Step,
        action: 'revised',
        detail: [
          reason ?? 'No reason given.',
          ...describeApprovalInput(input),
          added ? `Added contexts: ${added}` : '',
          describeProduced(produced),
        ].filter(Boolean).join('\n'),
      });
      return text(renderGate(next, { appUrl: current.appUrl, produced }));
    },
  );

  server.tool(
    'pbl_abort',
    'Close the session. The course is left exactly as it is.',
    { sessionId: z.string() },
    async ({ sessionId }) => {
      const current = rt.current;
      let state: CourseMemory;
      try {
        state = await current.store.load(current.env, sessionId);
      } catch (err) {
        // An unsafe id is a caller mistake, not a damaged file — keep the
        // traversal guard's own error.
        if (err instanceof Error && /Invalid course id/.test(err.message)) throw err;

        // A memory whose frontmatter cannot be parsed is exactly when closing
        // matters most: until the pointer is cleared the user cannot switch
        // environments, and the raw parse error tells them nothing to do about
        // it. Clear the pointer, leave the file untouched, and name both the
        // reason and the command. Removal stays theirs — the store has no
        // delete by design.
        if (current.activeSessionId === sessionId) current.activeSessionId = undefined;
        let path: string | undefined;
        try {
          path = current.store.pathFor(current.env, sessionId);
        } catch {
          path = undefined;
        }
        return text(
          [
            `Could not read the memory for "${sessionId}" — the file is left ` +
              `exactly as it is.`,
            `Reason: ${err instanceof Error ? err.message : String(err)}`,
            '',
            'The active-session pointer has been cleared, so you can switch ' +
              'environments or start another course.',
            ...(path ? ['To remove the unreadable file:', `  rm '${path}'`] : []),
          ].join('\n'),
        );
      }
      // `status` conflates two orthogonal things — session lifecycle (active/
      // closed) and backend publication (published) — so closing must not
      // clobber a publish fact the memory already recorded. If it did,
      // reconcile() would see status !== 'published' against a PUBLISHED
      // backend and print a false "never marked published" warning on the
      // next pbl_resume. The `closed` log entry below still records that the
      // session itself was closed. Re-modeling status into two fields is a
      // spec change, tracked separately — this ternary is the interim fix.
      await current.store.save(
        { ...state, status: state.status === 'published' ? 'published' : 'closed' },
        {
          step: state.step,
          action: 'closed',
          detail: 'Session closed. The course was not deleted.',
        },
      );
      if (current.activeSessionId === sessionId) current.activeSessionId = undefined;
      return text(
        `Closed "${state.title}". The course was not deleted, and the record stays ` +
          `in pbl_status.`,
      );
    },
  );
};
