import type { Course, CourseProblem, CourseSkill, ContentUnit } from '../api/builder.js';
import type { SessionState, Step } from './store.js';

export const STEP_ORDER: Step[] = [
  'context', 'skills', 'problems', 'outline', 'detail', 'publish', 'invite', 'done',
];

/** Steps the backend freezes once content-units/generate flips the course to DRAFT. */
const FROZEN_AFTER_OUTLINE: Step[] = ['context', 'skills', 'problems'];

export const nextStep = (step: Step): Step => {
  const i = STEP_ORDER.indexOf(step);
  if (i < 0 || i === STEP_ORDER.length - 1) return 'done';
  return STEP_ORDER[i + 1]!;
};

export interface MachineDeps {
  generateSkills(courseId: string): Promise<Course>;
  generateProblems(courseId: string): Promise<Course>;
  generateContentUnits(courseId: string): Promise<ContentUnit[]>;
  getCourse(courseId: string): Promise<Course>;
  selectSkill(courseId: string, courseSkillId: string, on: boolean): Promise<Course>;
  selectProblem(courseId: string, problemId: string, on: boolean): Promise<Course>;
  publish(courseId: string): Promise<Course>;
  invite(courseId: string, emails: string[]): Promise<unknown>;
  onProgress?(message: string): void;
}

export type Produced =
  | { kind: 'skills'; skills: CourseSkill[] }
  | { kind: 'problems'; problems: CourseProblem[] }
  | { kind: 'outline'; units: ContentUnit[] }
  | { kind: 'published' }
  | { kind: 'invited'; count: number }
  | { kind: 'none' };

export interface ApproveInput {
  /** Skill names to keep selected; everything else is deselected. */
  selectSkills?: string[];
  /** Problem title, id, or a unique prefix of either, to select. */
  selectProblem?: string;
  emails?: string[];
}

export interface AdvanceResult {
  state: SessionState;
  produced: Produced;
}

export const assertRevisable = (state: SessionState, step: Step): void => {
  // The outline step's own advance() case is what calls generateContentUnits
  // and flips the course to DRAFT, so the freeze is in effect from the moment
  // state.step becomes 'outline' — not only once 'detail' is reached.
  const outlineDone = STEP_ORDER.indexOf(state.step) >= STEP_ORDER.indexOf('outline');
  if (outlineDone && FROZEN_AFTER_OUTLINE.includes(step)) {
    throw new Error(
      `Cannot revise "${step}": context, skills and problems are frozen once ` +
        `the outline is generated (the course moved to DRAFT). Start a new ` +
        `course with an adjusted brief, or revise the outline instead.`,
    );
  }
};

const byName = <T extends { id: string }>(
  items: T[], label: (t: T) => string, needle: string, what: string,
): T => {
  const n = needle.trim().toLowerCase();
  const isMatch = (i: T) => label(i).toLowerCase() === n || i.id.toLowerCase() === n;
  const isPrefix = (i: T) =>
    label(i).toLowerCase().startsWith(n) || i.id.toLowerCase().startsWith(n);
  const exact = items.filter(isMatch);
  if (exact.length === 1) return exact[0]!;
  const pre = items.filter(isPrefix);
  if (pre.length === 1) return pre[0]!;
  const all = items.map(label).join(', ');
  if (pre.length > 1) {
    throw new Error(`"${needle}" matches more than one ${what}: ${pre.map(label).join(', ')}`);
  }
  throw new Error(`No ${what} matching "${needle}". Available: ${all}`);
};

export const advance = async (
  deps: MachineDeps,
  state: SessionState,
  input: ApproveInput = {},
): Promise<AdvanceResult> => {
  if (!state.awaitingApproval) {
    throw new Error(
      `Session ${state.id} is already in flight. Wait for the current step to finish.`,
    );
  }

  const to = nextStep(state.step);
  const done = (produced: Produced): AdvanceResult => ({
    state: { ...state, step: to, awaitingApproval: true, history: [...state.history, to] },
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
        throw new Error(
          'Choose a problem before building the outline — pass selectProblem with ' +
            'the scenario title.',
        );
      }
      const course = await deps.getCourse(state.courseId);
      const chosen = byName(
        course.CourseProblems ?? [],
        (p) => p.title ?? '(untitled)',
        input.selectProblem,
        'problem',
      );
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
        throw new Error(
          'No email addresses given. Pass emails to invite learners, or ' +
            'pbl_abort to finish without inviting.',
        );
      }
      await deps.invite(state.courseId, emails);
      return done({ kind: 'invited', count: emails.length });
    }

    default:
      return done({ kind: 'none' });
  }
};
