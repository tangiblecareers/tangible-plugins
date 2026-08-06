import type { ContentUnit, CourseSkill } from '../api/builder.js';
import { byName } from './by-name.js';

/** What the caller supplies for one sub-content unit. `minutes` is minutes. */
export interface SubUnitSpec {
  contentUnit: string;
  title: string;
  description?: string;
  minutes?: number;
  skills: string[];
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
 * Pure and total: it either returns a fully resolved plan or throws having
 * written nothing. The detail gate depends on that — a partial resolution
 * would leave sub-units created for the valid half of a breakdown and nothing
 * for the rest, with no way to tell which.
 *
 * Every message names the offender by name. No id appears in any error: the
 * caller addresses everything by name and has no use for one.
 */
export const planSubUnits = (
  specs: SubUnitSpec[],
  units: ContentUnit[],
  courseSkills: CourseSkill[],
): ResolvedSubUnit[] => {
  if (specs.length === 0) {
    throw new Error('Pass at least one sub-content unit to create.');
  }

  const selected = courseSkills.filter((s) => s.isSelected);

  return specs.map((s) => {
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

    const skills = s.skills.map((name) => {
      const match = byName(selected, (k) => k.CoreCompetencyModel.name, name, 'skill');
      if (!match.Level?.id) {
        throw new Error(
          `Skill "${match.CoreCompetencyModel.name}" has no level, and assigning a skill ` +
            `to a sub-content unit requires one. Choose a different skill for "${title}".`,
        );
      }
      return {
        coreCompetencyModelId: match.CoreCompetencyModel.id,
        levelId: match.Level.id,
        name: match.CoreCompetencyModel.name,
      };
    });

    return {
      contentUnitId: unit.id,
      contentUnitTitle: unit.title,
      title,
      ...(s.description !== undefined ? { description: s.description } : {}),
      ...(s.minutes !== undefined ? { estimatedDuration: s.minutes } : {}),
      skills,
    };
  });
};
