import { call } from './call.js';
export const publishCourse = (http, auth, courseId) => call(http, auth, {
    method: 'PATCH', path: `business/courses/${courseId}/publish`, body: {},
});
export const sendInvitations = (http, auth, courseId, emails) => call(http, auth, {
    method: 'POST', path: `business/courses/${courseId}/invitations`, body: { emails },
});
export const addResource = (http, auth, courseId, contentUnitId, subUnitId, values) => call(http, auth, {
    method: 'POST',
    path: `business/courses/${courseId}/content-units/${contentUnitId}` +
        `/sub-content-units/${subUnitId}/resources`,
    body: values,
});
