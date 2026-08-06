import { z } from 'zod';
import { addResource, publishCourse, sendInvitations } from '../api/courses.js';
import { listContentUnits } from '../api/builder.js';
import { listSubUnits, listSubUnitSkills } from '../api/subunits.js';
import { byName } from '../session/by-name.js';
import { courseUrl } from '../session/ledger.js';
import { text, banner } from './render.js';
export const registerDirectTools = (server, rt) => {
    server.tool('pbl_open_in_app', 'Return the Tangible app URL for a course, for eyes-on review.', { courseId: z.string() }, async ({ courseId }) => {
        const current = rt.current;
        return text(`${banner(current)}\n${courseUrl(current.appUrl, courseId)}`);
    });
    server.tool('pbl_add_resource', 'Attach a link or text resource to a sub-content unit.', {
        courseId: z.string(),
        contentUnit: z.string(),
        subUnit: z.string(),
        title: z.string(),
        type: z.enum(['LINK', 'TEXT']),
        url: z.string().url().optional(),
        content: z.string().optional(),
    }, async ({ courseId, contentUnit, subUnit, ...values }) => {
        const current = rt.current;
        const units = await listContentUnits(current.http, current.auth, courseId);
        const unit = byName(units, (u) => u.title, contentUnit, 'content unit');
        const subs = await listSubUnits(current.http, current.auth, courseId, unit.id);
        const sub = byName(subs, (s) => s.title, subUnit, 'sub-content unit');
        await addResource(current.http, current.auth, courseId, unit.id, sub.id, values);
        return text(`${banner(current)}\nAdded resource "${values.title}" to "${sub.title}".`);
    });
    server.tool('pbl_publish', 'Publish a DRAFT course — learners can see it afterwards.', { courseId: z.string() }, async ({ courseId }) => {
        const current = rt.current;
        // Tangible refuses to publish a course whose content units lack a
        // sub-unit with a skill. Check locally and name the gaps rather than
        // surfacing the backend's bare 400 — this is the failure this plugin hit
        // on every run before the detail layer existed.
        const units = await listContentUnits(current.http, current.auth, courseId);
        const gaps = [];
        for (const unit of units) {
            const subs = await listSubUnits(current.http, current.auth, courseId, unit.id);
            if (subs.length === 0) {
                gaps.push(`"${unit.title}" has no sub-content units`);
                continue;
            }
            const withSkill = [];
            for (const sub of subs) {
                const skills = await listSubUnitSkills(current.http, current.auth, courseId, unit.id, sub.id);
                if (skills.length > 0)
                    withSkill.push(sub.title);
            }
            if (withSkill.length === 0) {
                gaps.push(`"${unit.title}" has no sub-content unit with a skill`);
            }
        }
        if (gaps.length > 0) {
            throw new Error(`Cannot publish yet:\n${gaps.map((g) => `  ${g}`).join('\n')}\n` +
                `Run pbl_approve at the detail gate to build the missing sub-content units.`);
        }
        await publishCourse(current.http, current.auth, courseId);
        return text(`${banner(current)}\nPublished.\n${courseUrl(current.appUrl, courseId)}`);
    });
    server.tool('pbl_invite', 'Invite learners by email — this sends real mail and cannot be undone.', { courseId: z.string(), emails: z.array(z.string().email()).min(1) }, async ({ courseId, emails }) => {
        const current = rt.current;
        await sendInvitations(current.http, current.auth, courseId, emails);
        return text(`${banner(current)}\nInvited ${emails.length} learner${emails.length === 1 ? '' : 's'}.`);
    });
};
