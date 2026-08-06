import { byName } from './by-name.js';
export const STEP_ORDER = [
    'context', 'skills', 'problems', 'outline', 'detail', 'publish', 'invite', 'done',
];
/** Steps the backend freezes once content-units/generate flips the course to DRAFT. */
const FROZEN_AFTER_OUTLINE = ['context', 'skills', 'problems'];
export const nextStep = (step) => {
    const i = STEP_ORDER.indexOf(step);
    if (i < 0 || i === STEP_ORDER.length - 1)
        return 'done';
    return STEP_ORDER[i + 1];
};
export const assertRevisable = (state, step) => {
    // The outline step's own advance() case is what calls generateContentUnits
    // and flips the course to DRAFT, so the freeze is in effect from the moment
    // state.step becomes 'outline' — not only once 'detail' is reached.
    const outlineDone = STEP_ORDER.indexOf(state.step) >= STEP_ORDER.indexOf('outline');
    if (outlineDone && FROZEN_AFTER_OUTLINE.includes(step)) {
        throw new Error(`Cannot revise "${step}": context, skills and problems are frozen once ` +
            `the outline is generated (the course moved to DRAFT). Start a new ` +
            `course with an adjusted brief, or revise the outline instead.`);
    }
};
export const advance = async (deps, state, input = {}) => {
    if (!state.awaitingApproval) {
        throw new Error(`Session ${state.id} is already in flight. Wait for the current step to finish.`);
    }
    const to = nextStep(state.step);
    const done = (produced) => ({
        state: { ...state, step: to, awaitingApproval: true },
        produced,
    });
    switch (to) {
        case 'skills': {
            deps.onProgress?.('Generating skills…');
            const course = await deps.generateSkills(state.courseId);
            return done({ kind: 'skills', skills: course.CourseSkills ?? [] });
        }
        case 'problems': {
            if (input.selectSkills?.length) {
                const course = await deps.getCourse(state.courseId);
                const keep = new Set(input.selectSkills.map((s) => s.trim().toLowerCase()));
                for (const s of course.CourseSkills ?? []) {
                    const wanted = keep.has(s.CoreCompetencyModel.name.trim().toLowerCase());
                    if (s.isSelected !== wanted) {
                        await deps.selectSkill(state.courseId, s.id, wanted);
                    }
                }
            }
            deps.onProgress?.('Generating problem scenarios…');
            const course = await deps.generateProblems(state.courseId);
            return done({ kind: 'problems', problems: course.CourseProblems ?? [] });
        }
        case 'outline': {
            if (!input.selectProblem) {
                throw new Error('Choose a problem before building the outline — pass selectProblem with ' +
                    'the scenario title.');
            }
            const course = await deps.getCourse(state.courseId);
            const chosen = byName(course.CourseProblems ?? [], (p) => p.title ?? '(untitled)', input.selectProblem, 'problem');
            await deps.selectProblem(state.courseId, chosen.id, true);
            deps.onProgress?.('Generating the course outline…');
            const units = await deps.generateContentUnits(state.courseId);
            return done({ kind: 'outline', units });
        }
        case 'detail':
            // Sub-units, resources and artifacts are created un-gated by the tools
            // layer; this step exists so the outline gate and the publish gate stay
            // distinct in the ledger.
            return done({ kind: 'none' });
        case 'publish': {
            deps.onProgress?.('Publishing…');
            await deps.publish(state.courseId);
            return done({ kind: 'published' });
        }
        case 'invite': {
            const emails = input.emails ?? [];
            if (emails.length === 0) {
                throw new Error('No email addresses given. Pass emails to invite learners, or ' +
                    'pbl_abort to finish without inviting.');
            }
            await deps.invite(state.courseId, emails);
            return done({ kind: 'invited', count: emails.length });
        }
        default:
            return done({ kind: 'none' });
    }
};
