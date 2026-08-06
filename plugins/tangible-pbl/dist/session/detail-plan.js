import { byName } from './by-name.js';
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
export const planSubUnits = (specs, units, courseSkills) => {
    if (specs.length === 0) {
        throw new Error('Pass at least one sub-content unit to create.');
    }
    const selected = courseSkills.filter((s) => s.isSelected);
    // If every selected skill lacks a level, this is almost certainly the
    // client misreading the response shape rather than genuine course data —
    // see asCourse in src/api/builder.ts for the house style this follows.
    // Blaming individual skills (the per-skill message below) sends an
    // operator through every skill in the course before suspecting the client.
    if (selected.length > 0 && selected.every((s) => !s.Level?.id)) {
        throw new Error(`None of the ${selected.length} selected skills carries a level, and assigning a ` +
            `skill to a sub-content unit requires one. This is almost certainly a response-shape ` +
            `mismatch rather than course data — the client reads it from CourseSkill.Level.id. ` +
            `Keys actually present on a selected skill: ${Object.keys(selected[0]).join(', ')}. ` +
            `Report this shape.`);
    }
    const resolved = specs.map((s) => {
        const title = s.title?.trim() ?? '';
        if (title.length === 0) {
            throw new Error(`Every sub-content unit needs a title (under "${s.contentUnit}").`);
        }
        const unit = byName(units, (u) => u.title, s.contentUnit, 'content unit');
        if (s.skills.length === 0) {
            throw new Error(`"${title}" has no skills. Every sub-content unit needs at least one skill — ` +
                `publishing refuses a course whose sub-units have none.`);
        }
        if (s.skills.length > MAX_SKILLS) {
            throw new Error(`"${title}" has ${s.skills.length} skills. Tangible allows at most ten skills ` +
                `per sub-content unit.`);
        }
        if (s.minutes !== undefined) {
            if (!Number.isInteger(s.minutes) || s.minutes <= 0) {
                throw new Error(`"${title}" has minutes=${s.minutes}. Give a positive whole number of minutes.`);
            }
            if (s.minutes > MAX_MINUTES) {
                throw new Error(`"${title}" has minutes=${s.minutes}, above the maximum of 60000.`);
            }
        }
        const skills = s.skills.map((name) => {
            const match = byName(selected, (k) => k.CoreCompetencyModel.name, name, 'skill');
            if (!match.Level?.id) {
                throw new Error(`Skill "${match.CoreCompetencyModel.name}" has no level, and assigning a skill ` +
                    `to a sub-content unit requires one. Choose a different skill for "${title}".`);
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
    // A duplicate title under one content unit is accepted here and created on
    // the backend, but pbl_add_resource resolves a sub-unit by name — a second
    // "Intro" makes that lookup permanently ambiguous, and there is no rename,
    // delete or reorder route to fix it afterwards. Only collisions introduced
    // by this one breakdown are checked; an existing sub-unit with the same
    // title is a separate (and separately recoverable) problem.
    const seen = new Set();
    for (const r of resolved) {
        const key = `${r.contentUnitId}::${r.title.trim().toLowerCase()}`;
        if (seen.has(key)) {
            throw new Error(`"${r.contentUnitTitle}" has two sub-content units named "${r.title}". Titles must be ` +
                `unique within a content unit — pbl_add_resource resolves a sub-unit by name, and ` +
                `there is no way to rename one after it is created.`);
        }
        seen.add(key);
    }
    return resolved;
};
