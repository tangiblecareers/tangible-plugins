import { describe, it, expect, vi } from 'vitest';
import { AuthManager } from '../src/auth.js';
import { TangibleApiError, type HttpClient } from '../src/http.js';

const CREDS = { email: 'a@b.c', password: 'pw' };

const stubHttp = (impl: HttpClient['request']): HttpClient => ({ request: impl });

describe('AuthManager', () => {
  it('logs in once and caches the user token', async () => {
    const request = vi.fn().mockResolvedValue({ token: 'user-1' });
    const auth = new AuthManager(stubHttp(request as never), CREDS);

    expect(await auth.userToken()).toBe('user-1');
    expect(await auth.userToken()).toBe('user-1');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toMatchObject({
      method: 'POST',
      path: 'auth/login',
      body: { email: 'a@b.c', password: 'pw' },
    });
  });

  it('exchanges the user token for a business token', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ token: 'user-1' })
      .mockResolvedValueOnce({ token: 'biz-1', businessRole: 'ADMIN' });
    const auth = new AuthManager(stubHttp(request as never), CREDS);

    const ctx = await auth.loginBusiness('b-uuid', 'Acme');
    expect(ctx).toEqual({
      businessId: 'b-uuid',
      businessName: 'Acme',
      businessRole: 'ADMIN',
    });
    expect(await auth.businessToken()).toBe('biz-1');
    expect(request.mock.calls[1]![0]).toMatchObject({
      method: 'POST',
      path: 'auth/business/login',
      token: 'user-1',
      body: { businessId: 'b-uuid' },
    });
  });

  it('throws a clear error when no business is selected', async () => {
    const auth = new AuthManager(stubHttp(vi.fn() as never), CREDS);
    await expect(auth.businessToken()).rejects.toThrow(
      /No business selected.*pbl_use_business/,
    );
  });

  it('re-authenticates once on 401 and retries the call', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ token: 'user-1' })
      .mockResolvedValueOnce({ token: 'biz-1', businessRole: 'ADMIN' })
      .mockResolvedValueOnce({ token: 'user-2' })
      .mockResolvedValueOnce({ token: 'biz-2', businessRole: 'ADMIN' });
    const auth = new AuthManager(stubHttp(request as never), CREDS);
    await auth.loginBusiness('b-uuid', 'Acme');

    const call = vi
      .fn()
      .mockRejectedValueOnce(new TangibleApiError('expired', 401, {}))
      .mockResolvedValueOnce('ok');

    await expect(auth.withBusiness(call)).resolves.toBe('ok');
    expect(call).toHaveBeenNthCalledWith(1, 'biz-1');
    expect(call).toHaveBeenNthCalledWith(2, 'biz-2');
  });

  it('does not retry twice — a second 401 propagates', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ token: 'tok', businessRole: 'ADMIN' });
    const auth = new AuthManager(stubHttp(request as never), CREDS);
    await auth.loginBusiness('b-uuid', 'Acme');

    const call = vi.fn().mockRejectedValue(new TangibleApiError('expired', 401, {}));
    await expect(auth.withBusiness(call)).rejects.toThrow('expired');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-401 errors', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ token: 'tok', businessRole: 'ADMIN' });
    const auth = new AuthManager(stubHttp(request as never), CREDS);
    await auth.loginBusiness('b-uuid', 'Acme');

    const call = vi.fn().mockRejectedValue(new TangibleApiError('bad', 400, {}));
    await expect(auth.withBusiness(call)).rejects.toThrow('bad');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('reset clears both tokens and the business context', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ token: 'tok', businessRole: 'ADMIN' });
    const auth = new AuthManager(stubHttp(request as never), CREDS);
    await auth.loginBusiness('b-uuid', 'Acme');

    auth.reset();
    expect(auth.context()).toBeUndefined();
    await expect(auth.businessToken()).rejects.toThrow(/No business selected/);
  });

  it('withUser re-authenticates once on 401 and retries the call', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ token: 'user-1' })
      .mockResolvedValueOnce({ token: 'user-2' });
    const auth = new AuthManager(stubHttp(request as never), CREDS);

    const call = vi
      .fn()
      .mockRejectedValueOnce(new TangibleApiError('expired', 401, {}))
      .mockResolvedValueOnce('ok');

    await expect(auth.withUser(call)).resolves.toBe('ok');
    expect(call).toHaveBeenNthCalledWith(1, 'user-1');
    expect(call).toHaveBeenNthCalledWith(2, 'user-2');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('withUser does not retry twice — a second 401 propagates', async () => {
    const request = vi.fn().mockResolvedValue({ token: 'tok' });
    const auth = new AuthManager(stubHttp(request as never), CREDS);

    const call = vi.fn().mockRejectedValue(new TangibleApiError('expired', 401, {}));
    await expect(auth.withUser(call)).rejects.toThrow('expired');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('withUser does not retry non-401 errors', async () => {
    const request = vi.fn().mockResolvedValue({ token: 'tok' });
    const auth = new AuthManager(stubHttp(request as never), CREDS);

    const call = vi.fn().mockRejectedValue(new TangibleApiError('bad', 400, {}));
    await expect(auth.withUser(call)).rejects.toThrow('bad');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('withBusiness on fresh manager throws "No business selected" without retry', async () => {
    const request = vi.fn().mockResolvedValue({ token: 'tok', businessRole: 'ADMIN' });
    const auth = new AuthManager(stubHttp(request as never), CREDS);

    const call = vi.fn();
    await expect(auth.withBusiness(call)).rejects.toThrow(/No business selected/);
    expect(call).toHaveBeenCalledTimes(0);
  });
});
