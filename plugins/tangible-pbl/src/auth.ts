import { TangibleApiError, type HttpClient } from './http.js';

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
export class AuthManager {
  #user?: string;
  #business?: string;
  #ctx?: BusinessContext;

  constructor(
    private readonly http: HttpClient,
    private readonly creds: { email: string; password: string },
  ) {}

  async userToken(): Promise<string> {
    if (this.#user) return this.#user;
    const res = await this.http.request<{ token: string }>({
      method: 'POST',
      path: 'auth/login',
      body: { email: this.creds.email.trim(), password: this.creds.password },
    });
    this.#user = res.token;
    return res.token;
  }

  async loginBusiness(businessId: string, businessName: string): Promise<BusinessContext> {
    const res = await this.http.request<{ token: string; businessRole: string }>({
      method: 'POST',
      path: 'auth/business/login',
      token: await this.userToken(),
      body: { businessId },
    });
    this.#business = res.token;
    this.#ctx = { businessId, businessName, businessRole: res.businessRole };
    return this.#ctx;
  }

  async businessToken(): Promise<string> {
    if (!this.#business) {
      throw new Error(
        'No business selected. Call pbl_use_business first.',
      );
    }
    return this.#business;
  }

  context(): BusinessContext | undefined {
    return this.#ctx;
  }

  reset(): void {
    this.#user = undefined;
    this.#business = undefined;
    this.#ctx = undefined;
  }

  async withUser<T>(fn: (token: string) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.userToken());
    } catch (err) {
      if (!(err instanceof TangibleApiError) || err.status !== 401) throw err;
      this.#user = undefined;
      return fn(await this.userToken());
    }
  }

  async withBusiness<T>(fn: (token: string) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.businessToken());
    } catch (err) {
      if (!(err instanceof TangibleApiError) || err.status !== 401) throw err;
      const ctx = this.#ctx;
      if (!ctx) throw err;
      this.#user = undefined;
      this.#business = undefined;
      await this.loginBusiness(ctx.businessId, ctx.businessName);
      return fn(await this.businessToken());
    }
  }
}
