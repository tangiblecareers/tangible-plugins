import type { Produced } from './machine.js';
import { STEP_ORDER, nextStep } from './machine.js';
import type { CourseMemory } from './memory.js';

const VISIBLE = STEP_ORDER.filter((s) => s !== 'done');

export const courseUrl = (appUrl: string, courseId: string): string =>
  `${appUrl.replace(/\/+$/, '')}/business/problem-based-learning/courses/${courseId}`;

export const renderLedger = (state: CourseMemory): string => {
  const at = STEP_ORDER.indexOf(state.step);
  return VISIBLE.map((s, i) => `${i <= at ? '✓' : '○'} ${s}`).join(' · ');
};

const renderProduced = (produced: Produced): string => {
  switch (produced.kind) {
    case 'skills':
      return produced.skills.length === 0
        ? 'No skills were generated.'
        : ['Skills:', ...produced.skills.map(
            (s) => `  ${s.isSelected ? '●' : '○'} ${s.CoreCompetencyModel.name}` +
              (s.Level?.name ? ` (${s.Level.name})` : ''),
          )].join('\n');
    case 'problems':
      return produced.problems.length === 0
        ? 'No problems were generated.'
        : ['Problem scenarios:', ...produced.problems.map(
            (p, i) => `  ${i + 1}. ${p.title ?? '(untitled)'}`,
          )].join('\n');
    case 'outline':
      return produced.units.length === 0
        ? 'No content units were generated.'
        : ['Outline:', ...produced.units.map((u, i) => `  ${i + 1}. ${u.title}`)].join('\n');
    case 'published':
      return 'Course published.';
    case 'invited':
      return `Invitations sent to ${produced.count} learner${produced.count === 1 ? '' : 's'}.`;
    case 'none':
      return '';
  }
};

export const renderGate = (
  state: CourseMemory,
  opts: { appUrl: string; produced: Produced },
): string => {
  const banner =
    state.env === 'production'
      ? `⚠ PRODUCTION · ${state.businessName}`
      : `staging · ${state.businessName}`;

  const upcoming = nextStep(state.step);
  const next =
    upcoming === 'done'
      ? 'Nothing further — call pbl_abort to close the session.'
      : `Next: ${upcoming}. Call pbl_approve to continue, or pbl_revise to change this step.`;

  // Sub-content units don't exist yet (see README, "Current limitations"), so
  // pbl_publish will 400 no matter how far the ledger says the session has
  // come. Say so here — this gate response is the only surface an operator
  // actually reads.
  const detailLimitation =
    state.step === 'detail'
      ? 'No sub-content units are created yet — `pbl_publish` will return a backend ' +
        '400 until the detail layer lands. See README, "Current limitations".'
      : '';

  return [
    banner,
    renderLedger(state),
    '',
    renderProduced(opts.produced),
    detailLimitation,
    '',
    `Review: ${courseUrl(opts.appUrl, state.courseId)}`,
    next,
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n');
};
