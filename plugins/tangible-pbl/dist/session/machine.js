import { byName } from './by-name.js';
import { planSubUnits } from './detail-plan.js';
export const STEP_ORDER = [
    'context', 'skills', 'problems', 'outline', 'detail', 'artifacts',
    'publish', 'invite', 'done',
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
        case 'detail': {
            if (!input.subUnits?.length) {
                throw new Error('Pass subUnits to build the detail layer — each needs a contentUnit name, a ' +
                    'title, and at least one skill name. Nothing is created until this call.');
            }
            // Resolve and validate the whole breakdown first. planSubUnits throws
            // rather than resolving partially, so a bad name cannot leave half the
            // sub-units created with no way to tell which.
            const [units, course] = await Promise.all([
                deps.listContentUnits(state.courseId),
                deps.getCourse(state.courseId),
            ]);
            const plan = planSubUnits(input.subUnits, units, course.CourseSkills ?? []);
            const created = [];
            try {
                for (const r of plan) {
                    deps.onProgress?.(`Creating "${r.title}"…`);
                    const su = await deps.createSubUnit(state.courseId, r.contentUnitId, {
                        title: r.title,
                        ...(r.description !== undefined ? { description: r.description } : {}),
                        ...(r.estimatedDuration !== undefined
                            ? { estimatedDuration: r.estimatedDuration }
                            : {}),
                    });
                    for (const skill of r.skills) {
                        await deps.assignSkill(state.courseId, r.contentUnitId, su.id, {
                            coreCompetencyModelId: skill.coreCompetencyModelId,
                            levelId: skill.levelId,
                        });
                    }
                    created.push({
                        contentUnitTitle: r.contentUnitTitle,
                        title: r.title,
                        skills: r.skills.map((s) => s.name),
                    });
                }
            }
            catch (err) {
                // The spec accepted partial creation on the condition that the gate
                // reports exactly what landed. Without this, `created` is discarded
                // with the stack frame, state.step stays 'outline', and the natural
                // response — re-running pbl_approve with the same breakdown —
                // duplicates entries 1..created.length, which (combined with the
                // duplicate-title check above) permanently breaks pbl_add_resource
                // for them. Still throws: partial success is not success.
                const landed = created
                    .map((c) => `  ${c.contentUnitTitle} › ${c.title}`)
                    .join('\n');
                throw new Error(`Created ${created.length} of ${plan.length} sub-content units before this failed:\n` +
                    `${landed.length > 0 ? landed : '  (none)'}\n` +
                    `Re-running pbl_approve with this breakdown would duplicate the ones listed above ` +
                    `— resend only the entries that are not listed. Underlying error: ` +
                    `${err instanceof Error ? err.message : String(err)}`, { cause: err });
            }
            return done({ kind: 'detail', created });
        }
        case 'artifacts': {
            const units = await deps.listContentUnits(state.courseId);
            const generated = [];
            const failed = [];
            for (const unit of units) {
                for (const sub of await deps.listSubUnits(state.courseId, unit.id)) {
                    deps.onProgress?.(`Generating the artifact for "${sub.title}"…`);
                    try {
                        await deps.generateArtifact(state.courseId, unit.id, sub.id, {
                            ...(input.instruction !== undefined ? { instruction: input.instruction } : {}),
                        });
                        generated.push(sub.title);
                    }
                    catch (err) {
                        // 409 means an artifact already exists, which satisfies the goal of
                        // "every sub-unit has one" — regenerating is a separate decision.
                        if (err.status === 409) {
                            generated.push(sub.title);
                            continue;
                        }
                        // Carry on: aborting here would discard every generation that
                        // already succeeded, and there is no way to resume mid-gate.
                        failed.push({
                            title: sub.title,
                            reason: err instanceof Error ? err.message : String(err),
                        });
                    }
                }
            }
            // asArray (subunits.ts) returns [] silently for an unrecognised list
            // shape — deliberately, and not changed here. But that silence means a
            // wrongly-shaped response and "the detail gate created nothing" are
            // indistinguishable from generated:[]/failed:[] alone, and this gate
            // would otherwise advance having done nothing: pbl_publish then reports
            // "has no sub-content units" (false — sub-units may well exist),
            // pbl_status shows nothing, and none of that points at the real cause.
            // Refuse to advance on this vacuous case instead.
            if (units.length > 0 && generated.length === 0 && failed.length === 0) {
                throw new Error(`No sub-units were found under any of the ${units.length} content unit` +
                    `${units.length === 1 ? '' : 's'}. Either the detail gate created nothing, or the ` +
                    `sub-unit list response is not shaped the way listSubUnits expects. Run pbl_status ` +
                    `to see the breakdown before retrying.`);
            }
            return done({ kind: 'artifacts', generated, failed });
        }
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
