import type { ContentUnit, CourseSkill } from '../api/builder.js';
import type { CompetencyLevel } from '../api/competency.js';
import { byName } from './by-name.js';

/** One skill assigned to a sub-content unit, and the level to assign it at. */
export interface SubUnitSkillSpec {
  name: string;
  /** By name. Omit only when the skill's competency has exactly one level. */
  level?: string;
}

/** What the caller supplies for one sub-content unit. `minutes` is minutes. */
export interface SubUnitSpec {
  contentUnit: string;
  title: string;
  description?: string;
  minutes?: number;
  skills: SubUnitSkillSpec[];
}

export interface ResolvedSkill {
  coreCompetencyModelId: string;
  levelId: string;
  name: string;
}

export interface ResolvedSubUnit {
  contentUnitId: string;
  contentUnitTitle: string;
  title: string;
  description?: string;
  estimatedDuration?: number;
  skills: ResolvedSkill[];
}

/** Server-enforced by subContentUnitSkillUnderLimit. */
const MAX_SKILLS = 10;
/** Server-enforced ceiling on estimatedDuration, in minutes. */
const MAX_MINUTES = 60000;

/**
 * Resolves a caller-supplied breakdown against the live course, or throws.
 *
 * Pure and total: it never fetches, and it either returns a fully resolved
 * plan or throws having written nothing. `levelsByCompetencyId` must already
 * hold every selected skill's levels the breakdown could reference — the
 * caller (the "detail" case in machine.ts) collects the distinct skill names
 * across the whole breakdown and fetches each competency's levels once,
 * before calling this and before any write. That split matters for two
 * reasons: a partial resolution here would leave sub-units created for the
 * valid half of a breakdown with no way to tell which, and a fetch buried in
 * a pure resolver would make "validate everything before the first write"
 * impossible to guarantee.
 *
 * A skill is no longer resolved via `CourseSkill.Level` — that field does not
 * exist on the backend and never can (see CLAUDE.md). The level is chosen
 * per sub-unit, against the skill's competency's own levels.
 *
 * Every message names the offender by name. No id appears in any error: the
 * caller addresses everything by name and has no use for one.
 */
export const planSubUnits = (
  specs: SubUnitSpec[],
  units: ContentUnit[],
  courseSkills: CourseSkill[],
  levelsByCompetencyId: Map<string, CompetencyLevel[]>,
): ResolvedSubUnit[] => {
  if (specs.length === 0) {
    throw new Error('Pass at least one sub-content unit to create.');
  }

  const selected = courseSkills.filter((s) => s.isSelected);

  const resolveSkill = (title: string, skillSpec: SubUnitSkillSpec): ResolvedSkill => {
    const match = byName(selected, (k) => k.CoreCompetencyModel.name, skillSpec.name, 'skill');
    const levels = levelsByCompetencyId.get(match.CoreCompetencyModel.id) ?? [];

    if (levels.length === 0) {
      throw new Error(
        `Skill "${match.CoreCompetencyModel.name}" has no levels defined for its ` +
          `competency, so it cannot be assigned to a sub-content unit. This is a data ` +
          `problem, not a client bug — it must be fixed in the app by adding at least ` +
          `one level to that competency.`,
      );
    }

    let level: CompetencyLevel | undefined;
    if (skillSpec.level !== undefined) {
      const wanted = skillSpec.level.trim().toLowerCase();
      level = levels.find((l) => l.name.trim().toLowerCase() === wanted);
      if (!level) {
        throw new Error(
          `Skill "${match.CoreCompetencyModel.name}" has no level named "${skillSpec.level}". ` +
            `Available levels: ${levels.map((l) => l.name).join(', ')}.`,
        );
      }
    } else if (levels.length === 1) {
      level = levels[0]!;
    } else {
      throw new Error(
        `"${title}" needs a level for skill "${match.CoreCompetencyModel.name}" — this ` +
          `competency has ${levels.length} levels: ${levels.map((l) => l.name).join(', ')}. ` +
          `Pass one by name in skills[].level.`,
      );
    }

    return {
      coreCompetencyModelId: match.CoreCompetencyModel.id,
      levelId: level.id,
      name: match.CoreCompetencyModel.name,
    };
  };

  const resolved = specs.map((s) => {
    const title = s.title?.trim() ?? '';
    if (title.length === 0) {
      throw new Error(`Every sub-content unit needs a title (under "${s.contentUnit}").`);
    }

    const unit = byName(units, (u) => u.title, s.contentUnit, 'content unit');

    if (s.skills.length === 0) {
      throw new Error(
        `"${title}" has no skills. Every sub-content unit needs at least one skill — ` +
          `publishing refuses a course whose sub-units have none.`,
      );
    }
    if (s.skills.length > MAX_SKILLS) {
      throw new Error(
        `"${title}" has ${s.skills.length} skills. Tangible allows at most ten skills ` +
          `per sub-content unit.`,
      );
    }

    if (s.minutes !== undefined) {
      if (!Number.isInteger(s.minutes) || s.minutes <= 0) {
        throw new Error(
          `"${title}" has minutes=${s.minutes}. Give a positive whole number of minutes.`,
        );
      }
      if (s.minutes > MAX_MINUTES) {
        throw new Error(`"${title}" has minutes=${s.minutes}, above the maximum of 60000.`);
      }
    }

    const skills = s.skills.map((skillSpec) => resolveSkill(title, skillSpec));

    return {
      contentUnitId: unit.id,
      contentUnitTitle: unit.title,
      title,
      ...(s.description !== undefined ? { description: s.description } : {}),
      ...(s.minutes !== undefined ? { estimatedDuration: s.minutes } : {}),
      skills,
    };
  });

  // A duplicate title under one content unit is accepted here and created on
  // the backend, but pbl_add_resource resolves a sub-unit by name — a second
  // "Intro" makes that lookup permanently ambiguous, and there is no rename,
  // delete or reorder route to fix it afterwards. Only collisions introduced
  // by this one breakdown are checked; an existing sub-unit with the same
  // title is a separate (and separately recoverable) problem.
  const seen = new Set<string>();
  for (const r of resolved) {
    const key = `${r.contentUnitId}::${r.title.trim().toLowerCase()}`;
    if (seen.has(key)) {
      throw new Error(
        `"${r.contentUnitTitle}" has two sub-content units named "${r.title}". Titles must be ` +
          `unique within a content unit — pbl_add_resource resolves a sub-unit by name, and ` +
          `there is no way to rename one after it is created.`,
      );
    }
    seen.add(key);
  }

  return resolved;
};
