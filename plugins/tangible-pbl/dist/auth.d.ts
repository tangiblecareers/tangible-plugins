import { type HttpClient } from './http.js';
export interface BusinessContext {
    businessId: string;
    businessName: string;
    businessRole: string;
}
/**
 * The two-step handshake from frontend/src/providers/authProvider.ts:59-149.
 * POST /auth/login yields a personal JWT; POST /auth/business/login exchanges
 * it for a business-scoped JWT carrying businessId and businessRole. Every
 * business/* endpoint needs the second token. Tokens live in memory only.
 */
export declare class AuthManager {
    #private;
    private readonly http;
    private readonly creds;
    constructor(http: HttpClient, creds: {
        email: string;
        password: string;
    });
    userToken(): Promise<string>;
    /** The authenticated user's own id. Logs in if that has not happened yet. */
    userId(): Promise<string>;
    loginBusiness(businessId: string, businessName: string): Promise<BusinessContext>;
    businessToken(): Promise<string>;
    context(): BusinessContext | undefined;
    reset(): void;
    withUser<T>(fn: (token: string) => Promise<T>): Promise<T>;
    withBusiness<T>(fn: (token: string) => Promise<T>): Promise<T>;
}
