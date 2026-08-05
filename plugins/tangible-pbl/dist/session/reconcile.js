import { STEP_ORDER } from './machine.js';
/**
 * Pure comparison so it is testable without HTTP. Reports and never auto-fixes
 * — the backend is authoritative for content, and a memory that silently
 * rewrote itself to match would destroy the record this feature exists to keep.
 */
export const reconcile = (m, course, units) => {
    const out = [];
    if (course.title && course.title !== m.title) {
        out.push({
            what: 'title',
            detail: `Memory calls this "${m.title}"; the course is now "${course.title}". ` +
                `The file keeps the slug it was created with.`,
        });
    }
    // Once the course is DRAFT the outline exists, which freezes contexts,
    // skills and problems permanently. Saying so now beats a confusing 403
    // several calls later.
    const reachedOutline = STEP_ORDER.indexOf(m.step) >= STEP_ORDER.indexOf('outline');
    if (course.status === 'DRAFT' && !reachedOutline) {
        out.push({
            what: 'course status',
            detail: `Memory stopped at "${m.step}", but the course is DRAFT — the outline ` +
                `already exists, so context, skills and problems are frozen. ` +
                `${units.length} content unit${units.length === 1 ? '' : 's'} present.`,
        });
    }
    if (course.status === 'PUBLISHED' && m.status !== 'published') {
        out.push({
            what: 'published',
            detail: 'The course is PUBLISHED, but this memory was never marked published.',
        });
    }
    // pbl_resume never un-closes a course itself — only an approve after
    // resuming does (see pbl_approve) — so a resume against a closed memory
    // should say so, in the same report-don't-fix style as every other
    // difference here, rather than silently letting the human keep working
    // against a course pbl_status still lists as closed.
    if (m.status === 'closed') {
        out.push({
            what: 'closed',
            detail: 'This memory was closed with pbl_abort. Approving a step will reopen it.',
        });
    }
    // Archival is a fact about the course, not something the memory's own
    // status field mirrors — reporting it here, rather than folding it into
    // CourseStatusLabel, is what keeps this a report-don't-fix comparison.
    if (course.status === 'ARCHIVED') {
        out.push({
            what: 'archived',
            detail: 'The course has been archived in the web app. It cannot be authored ' +
                'against any further — start a new course if the work needs to continue.',
        });
    }
    return out;
};
export const renderResume = (m, course, units, differences) => {
    const head = [
        `Resumed "${m.title}" (${m.env} · ${m.businessName})`,
        `Memory says: ${m.step}${m.awaitingApproval ? ', awaiting approval' : ''}`,
        `Backend says: ${course.status}, ${units.length} content unit${units.length === 1 ? '' : 's'}`,
    ];
    if (differences.length === 0)
        return [...head, '', 'In sync with the backend.'].join('\n');
    return [
        ...head,
        '',
        ...differences.map((d) => `⚠ ${d.detail}`),
        '',
        'The backend is authoritative. Nothing was changed.',
    ].join('\n');
};
