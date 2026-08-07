import type { Course, CourseProblem, CourseSkill, ContentUnit } from '../api/builder.js';
import type { CompetencyLevel } from '../api/competency.js';
import type { CourseMemory, Step } from './memory.js';
import { byName } from './by-name.js';
import { planSubUnits, type SubUnitSpec } from './detail-plan.js';
import type { SubContentUnit } from '../api/subunits.js';

export const STEP_ORDER: Step[] = [
  'context', 'skills', 'problems', 'outline', 'detail', 'artifacts',
  'publish', 'invite', 'done',
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
  listContentUnits(courseId: string): Promise<ContentUnit[]>;
  createSubUnit(
    courseId: string, contentUnitId: string,
    values: { title: string; description?: string; estimatedDuration?: number },
  ): Promise<SubContentUnit>;
  assignSkill(
    courseId: string, contentUnitId: string, subUnitId: string,
    body: { coreCompetencyModelId: string; levelId: string },
  ): Promise<unknown>;
  /** No CourseSkill carries a level — this is how the detail gate finds one. */
  getCompetencyLevels(coreCompetencyModelId: string): Promise<CompetencyLevel[]>;
  listSubUnits(courseId: string, contentUnitId: string): Promise<SubContentUnit[]>;
  generateArtifact(
    courseId: string, contentUnitId: string, subUnitId: string,
    body: { instruction?: string },
  ): Promise<unknown>;
  publish(courseId: string): Promise<Course>;
  invite(courseId: string, emails: string[]): Promise<unknown>;
  onProgress?(message: string): void;
}

export type Produced =
  | { kind: 'skills'; skills: CourseSkill[] }
  | { kind: 'problems'; problems: CourseProblem[] }
  | { kind: 'outline'; units: ContentUnit[] }
  | { kind: 'detail'; created: { contentUnitTitle: string; title: string; skills: string[] }[] }
  | { kind: 'artifacts'; generated: string[]; failed: { title: string; reason: string }[] }
  | { kind: 'published' }
  | { kind: 'invited'; count: number }
  | { kind: 'none' };

export interface ApproveInput {
  /** Skill names to keep selected; everything else is deselected. */
  selectSkills?: string[];
  /** Problem title, id, or a unique prefix of either, to select. */
  selectProblem?: string;
  emails?: string[];
  /** The sub-content-unit breakdown, required when advancing to "detail". */
  subUnits?: SubUnitSpec[];
  /** Optional steer applied to every artifact generated at the "artifacts" gate. */
  instruction?: string;
}

export interface AdvanceResult {
  state: CourseMemory;
  produced: Produced;
}

export const assertRevisable = (state: CourseMemory, step: Step): void => {
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

export const advance = async (
  deps: MachineDeps,
  state: CourseMemory,
  input: ApproveInput = {},
): Promise<AdvanceResult> => {
  if (!state.awaitingApproval) {
    throw new Error(
      `Session ${state.id} is already in flight. Wait for the current step to finish.`,
    );
  }

  const to = nextStep(state.step);
  const done = (produced: Produced): AdvanceResult => ({
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

    case 'detail': {
      if (!input.subUnits?.length) {
        throw new Error(
          'Pass subUnits to build the detail layer — each needs a contentUnit name, a ' +
            'title, and at least one skill name. Nothing is created until this call.',
        );
      }
      // Resolve and validate the whole breakdown first. planSubUnits throws
      // rather than resolving partially, so a bad name cannot leave half the
      // sub-units created with no way to tell which.
      const [units, course] = await Promise.all([
        deps.listContentUnits(state.courseId),
        deps.getCourse(state.courseId),
      ]);
      const selected = (course.CourseSkills ?? []).filter((s) => s.isSelected);

      // No CourseSkill carries a level — it is chosen per sub-unit, against
      // the skill's competency's own levels (see CLAUDE.md). Fetch each
      // distinct skill's levels exactly once, before any write: sequentially,
      // so two names that happen to share a competency id cannot race each
      // other into two fetches for the one map entry.
      const distinctNames = new Set(input.subUnits.flatMap((s) => s.skills.map((k) => k.name)));
      const levelsByCompetencyId = new Map<string, CompetencyLevel[]>();
      for (const name of distinctNames) {
        const match = byName(selected, (s) => s.CoreCompetencyModel.name, name, 'skill');
        if (!levelsByCompetencyId.has(match.CoreCompetencyModel.id)) {
          levelsByCompetencyId.set(
            match.CoreCompetencyModel.id,
            await deps.getCompetencyLevels(match.CoreCompetencyModel.id),
          );
        }
      }

      const plan = planSubUnits(input.subUnits, units, course.CourseSkills ?? [], levelsByCompetencyId);

      const created: { contentUnitTitle: string; title: string; skills: string[] }[] = [];
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
      } catch (err) {
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
        throw new Error(
          `Created ${created.length} of ${plan.length} sub-content units before this failed:\n` +
            `${landed.length > 0 ? landed : '  (none)'}\n` +
            `Re-running pbl_approve with this breakdown would duplicate the ones listed above ` +
            `— resend only the entries that are not listed. Underlying error: ` +
            `${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      return done({ kind: 'detail', created });
    }

    case 'artifacts': {
      const units = await deps.listContentUnits(state.courseId);
      const generated: string[] = [];
      const failed: { title: string; reason: string }[] = [];

      for (const unit of units) {
        for (const sub of await deps.listSubUnits(state.courseId, unit.id)) {
          deps.onProgress?.(`Generating the artifact for "${sub.title}"…`);
          try {
            await deps.generateArtifact(state.courseId, unit.id, sub.id, {
              ...(input.instruction !== undefined ? { instruction: input.instruction } : {}),
            });
            generated.push(sub.title);
          } catch (err) {
            // 409 means an artifact already exists, which satisfies the goal of
            // "every sub-unit has one" — regenerating is a separate decision.
            if ((err as { status?: number }).status === 409) {
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
        throw new Error(
          `No sub-units were found under any of the ${units.length} content unit` +
            `${units.length === 1 ? '' : 's'}. Either the detail gate created nothing, or the ` +
            `sub-unit list response is not shaped the way listSubUnits expects. Run pbl_status ` +
            `to see the breakdown before retrying.`,
        );
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
