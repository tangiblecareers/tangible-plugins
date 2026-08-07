import { STEP_ORDER, nextStep } from './machine.js';
const VISIBLE = STEP_ORDER.filter((s) => s !== 'done');
export const courseUrl = (appUrl, courseId) => `${appUrl.replace(/\/+$/, '')}/business/problem-based-learning/courses/${courseId}`;
export const renderLedger = (state) => {
    const at = STEP_ORDER.indexOf(state.step);
    return VISIBLE.map((s, i) => `${i <= at ? '✓' : '○'} ${s}`).join(' · ');
};
/**
 * Renders the content-unit / sub-unit / skill breakdown pbl_status shows once
 * the "detail" step is reached. This is how an operator confirms the detail
 * gate did what they approved, and spots a sub-unit that would block
 * pbl_publish before running it.
 *
 * `SubUnitSkill.name` is optional (subunits.ts) — the backend can return a
 * skill with only a bare `coreCompetencyModelId`. Rendering that id would be
 * a UUID leak, breaching this plugin's standing non-negotiable. A sub-unit
 * whose skills are not all named therefore renders as a count instead of a
 * name list — do NOT "fix" this by falling back to the id.
 */
export const renderBreakdown = (units) => {
    const lines = [];
    for (const u of units) {
        lines.push(u.title);
        for (const s of u.subs) {
            if (s.skills.length === 0) {
                lines.push(`  ${s.title}`);
                continue;
            }
            const names = s.skills.map((k) => k.name).filter((n) => Boolean(n));
            lines.push(names.length === s.skills.length
                ? `  ${s.title} [${names.join(', ')}]`
                : `  ${s.title} (${s.skills.length} skill${s.skills.length === 1 ? '' : 's'})`);
        }
    }
    return lines.length > 0 ? `\n\nBreakdown:\n${lines.join('\n')}` : '';
};
/**
 * Renders the selected skills and their available levels, shown by
 * pbl_status from the "skills" gate onward — this is the only place a
 * caller can discover level names before guessing wrong at the "detail"
 * gate and reading the error. A skill with no levels renders `(no levels)`
 * rather than being omitted: that is precisely what an operator must see and
 * fix in the app before "detail" will accept it. Names only, never a level
 * or competency id.
 */
export const renderSkills = (skills) => {
    if (skills.length === 0)
        return '';
    const lines = skills.map((s) => {
        if (s.levels === null)
            return `  ${s.name} — (levels unavailable)`;
        if (s.levels.length === 0)
            return `  ${s.name} — (no levels)`;
        return `  ${s.name} — ${s.levels.join(', ')}`;
    });
    return `\n\nSkills:\n${lines.join('\n')}`;
};
const renderProduced = (produced) => {
    switch (produced.kind) {
        case 'skills':
            return produced.skills.length === 0
                ? 'No skills were generated.'
                : ['Skills:', ...produced.skills.map((s) => `  ${s.isSelected ? '●' : '○'} ${s.CoreCompetencyModel.name}`)].join('\n');
        case 'problems':
            return produced.problems.length === 0
                ? 'No problems were generated.'
                : ['Problem scenarios:', ...produced.problems.map((p, i) => `  ${i + 1}. ${p.title ?? '(untitled)'}`)].join('\n');
        case 'outline':
            return produced.units.length === 0
                ? 'No content units were generated.'
                : ['Outline:', ...produced.units.map((u, i) => `  ${i + 1}. ${u.title}`)].join('\n');
        case 'detail':
            return produced.created.length === 0
                ? 'No sub-content units were created.'
                : ['Sub-content units:', ...produced.created.map((c) => `  ${c.contentUnitTitle} › ${c.title} [${c.skills.join(', ')}]`)].join('\n');
        case 'artifacts': {
            const lines = [`Artifacts: ${produced.generated.length} generated.`];
            if (produced.failed.length > 0) {
                lines.push(`${produced.failed.length} failed:`, ...produced.failed.map((f) => `  ${f.title} — ${f.reason}`));
            }
            return lines.join('\n');
        }
        case 'published':
            return 'Course published.';
        case 'invited':
            return `Invitations sent to ${produced.count} learner${produced.count === 1 ? '' : 's'}.`;
        case 'none':
            return '';
    }
};
export const renderGate = (state, opts) => {
    const banner = state.env === 'production'
        ? `⚠ PRODUCTION · ${state.businessName}`
        : `staging · ${state.businessName}`;
    const upcoming = nextStep(state.step);
    const next = upcoming === 'done'
        ? 'Nothing further — call pbl_abort to close the session.'
        : `Next: ${upcoming}. Call pbl_approve to continue, or pbl_revise to change this step.`;
    return [
        banner,
        renderLedger(state),
        '',
        renderProduced(opts.produced),
        '',
        `Review: ${courseUrl(opts.appUrl, state.courseId)}`,
        next,
    ]
        .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
        .join('\n');
};
