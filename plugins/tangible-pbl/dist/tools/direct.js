import { z } from 'zod';
import { addResource, publishCourse, sendInvitations } from '../api/courses.js';
import { courseUrl } from '../session/ledger.js';
import { text, banner } from './render.js';
export const registerDirectTools = (server, rt) => {
    server.tool('pbl_open_in_app', 'Return the Tangible app URL for a course, for eyes-on review.', { courseId: z.string() }, async ({ courseId }) => {
        const current = rt.current;
        return text(`${banner(current)}\n${courseUrl(current.appUrl, courseId)}`);
    });
    server.tool('pbl_add_resource', 'Attach a link or text resource to a sub-content unit.', {
        courseId: z.string(),
        contentUnitId: z.string(),
        subUnitId: z.string(),
        title: z.string(),
        type: z.enum(['LINK', 'TEXT']),
        url: z.string().url().optional(),
        content: z.string().optional(),
    }, async ({ courseId, contentUnitId, subUnitId, ...values }) => {
        const current = rt.current;
        await addResource(current.http, current.auth, courseId, contentUnitId, subUnitId, values);
        return text(`${banner(current)}\nAdded resource "${values.title}".`);
    });
    server.tool('pbl_publish', 'Publish a DRAFT course. Gate 5 — learners can see it afterwards.', { courseId: z.string() }, async ({ courseId }) => {
        const current = rt.current;
        await publishCourse(current.http, current.auth, courseId);
        return text(`${banner(current)}\nPublished.\n${courseUrl(current.appUrl, courseId)}`);
    });
    server.tool('pbl_invite', 'Invite learners by email. Gate 6 — this sends real mail and cannot be undone.', { courseId: z.string(), emails: z.array(z.string().email()).min(1) }, async ({ courseId, emails }) => {
        const current = rt.current;
        await sendInvitations(current.http, current.auth, courseId, emails);
        return text(`${banner(current)}\nInvited ${emails.length} learner${emails.length === 1 ? '' : 's'}.`);
    });
};
