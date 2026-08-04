import type { Env } from '../config.js';
export type Step = 'context' | 'skills' | 'problems' | 'outline' | 'detail' | 'publish' | 'invite' | 'done';
export interface SessionState {
    id: string;
    env: Env;
    courseId: string;
    businessId: string;
    businessName: string;
    brief: string;
    sourceUrl?: string;
    step: Step;
    awaitingApproval: boolean;
    history: string[];
}
/**
 * Holds only pointers and progress. Course content is always re-read from the
 * API, so this file can never disagree with the backend.
 */
export declare class SessionStore {
    #private;
    private readonly root;
    constructor(root?: string);
    save(s: SessionState): Promise<void>;
    load(env: Env, id: string): Promise<SessionState>;
    list(env: Env): Promise<SessionState[]>;
    delete(env: Env, id: string): Promise<void>;
}
