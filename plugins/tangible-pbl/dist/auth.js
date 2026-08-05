import { TangibleApiError } from './http.js';
/**
 * The two-step handshake from frontend/src/providers/authProvider.ts:59-149.
 * POST /auth/login yields a personal JWT; POST /auth/business/login exchanges
 * it for a business-scoped JWT carrying businessId and businessRole. Every
 * business/* endpoint needs the second token. Tokens live in memory only.
 */
export class AuthManager {
    http;
    creds;
    #user;
    #userId;
    #business;
    #ctx;
    constructor(http, creds) {
        this.http = http;
        this.creds = creds;
    }
    async userToken() {
        if (this.#user)
            return this.#user;
        const res = await this.http.request({
            method: 'POST',
            path: 'auth/login',
            body: { email: this.creds.email.trim(), password: this.creds.password },
        });
        this.#user = res.token;
        // generateLoginResponse (backend/src/helpers/auth.helper.ts:69) returns the
        // user id alongside the token. listBusinesses needs it to read the caller's
        // own profile, which is the only place membership rows are exposed.
        this.#userId = res.id;
        return res.token;
    }
    /** The authenticated user's own id. Logs in if that has not happened yet. */
    async userId() {
        if (!this.#userId)
            await this.userToken();
        if (!this.#userId) {
            throw new Error('Login succeeded but returned no user id.');
        }
        return this.#userId;
    }
    async loginBusiness(businessId, businessName) {
        const res = await this.http.request({
            method: 'POST',
            path: 'auth/business/login',
            token: await this.userToken(),
            body: { businessId },
        });
        this.#business = res.token;
        this.#ctx = { businessId, businessName, businessRole: res.businessRole };
        return this.#ctx;
    }
    async businessToken() {
        if (!this.#business) {
            throw new Error('No business selected. Call pbl_use_business first.');
        }
        return this.#business;
    }
    context() {
        return this.#ctx;
    }
    reset() {
        this.#user = undefined;
        this.#userId = undefined;
        this.#business = undefined;
        this.#ctx = undefined;
    }
    async withUser(fn) {
        try {
            return await fn(await this.userToken());
        }
        catch (err) {
            if (!(err instanceof TangibleApiError) || err.status !== 401)
                throw err;
            this.#user = undefined;
            return fn(await this.userToken());
        }
    }
    async withBusiness(fn) {
        try {
            return await fn(await this.businessToken());
        }
        catch (err) {
            if (!(err instanceof TangibleApiError) || err.status !== 401)
                throw err;
            const ctx = this.#ctx;
            if (!ctx)
                throw err;
            this.#user = undefined;
            this.#business = undefined;
            await this.loginBusiness(ctx.businessId, ctx.businessName);
            return fn(await this.businessToken());
        }
    }
}
