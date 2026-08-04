import type { AuthManager } from '../auth.js';
import type { HttpClient } from '../http.js';
import type { Course } from './builder.js';
import { call } from './call.js';

export type ResourceType = 'LINK' | 'TEXT';

export const publishCourse = (http: HttpClient, auth: AuthManager, courseId: string) =>
  call<Course>(http, auth, {
    method: 'PATCH', path: `business/courses/${courseId}/publish`, body: {},
  });

export const sendInvitations = (
  http: HttpClient, auth: AuthManager, courseId: string, emails: string[],
) =>
  call<unknown>(http, auth, {
    method: 'POST', path: `business/courses/${courseId}/invitations`, body: { emails },
  });

export const addResource = (
  http: HttpClient, auth: AuthManager,
  courseId: string, contentUnitId: string, subUnitId: string,
  values: { title: string; type: ResourceType; url?: string; content?: string },
) =>
  call<unknown>(http, auth, {
    method: 'POST',
    path:
      `business/courses/${courseId}/content-units/${contentUnitId}` +
      `/sub-content-units/${subUnitId}/resources`,
    body: values,
  });
