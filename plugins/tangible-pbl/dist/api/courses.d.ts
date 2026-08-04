import type { AuthManager } from '../auth.js';
import type { HttpClient } from '../http.js';
import type { Course } from './builder.js';
export type ResourceType = 'LINK' | 'TEXT';
export declare const publishCourse: (http: HttpClient, auth: AuthManager, courseId: string) => Promise<Course>;
export declare const sendInvitations: (http: HttpClient, auth: AuthManager, courseId: string, emails: string[]) => Promise<unknown>;
export declare const addResource: (http: HttpClient, auth: AuthManager, courseId: string, contentUnitId: string, subUnitId: string, values: {
    title: string;
    type: ResourceType;
    url?: string;
    content?: string;
}) => Promise<unknown>;
