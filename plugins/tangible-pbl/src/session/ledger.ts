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
    case 'detail':
      return produced.created.length === 0
        ? 'No sub-content units were created.'
        : ['Sub-content units:', ...produced.created.map(
            (c) => `  ${c.contentUnitTitle} › ${c.title} [${c.skills.join(', ')}]`,
          )].join('\n');
    case 'artifacts': {
      const lines = [`Artifacts: ${produced.generated.length} generated.`];
      if (produced.failed.length > 0) {
        lines.push(
          `${produced.failed.length} failed:`,
          ...produced.failed.map((f) => `  ${f.title} — ${f.reason}`),
        );
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
