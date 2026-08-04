export declare class TangibleApiError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(message: string, status: number, body: unknown);
}
export interface RequestOpts {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    path: string;
    body?: unknown;
    token?: string;
    query?: Record<string, string>;
}
export interface HttpClient {
    request<T>(opts: RequestOpts): Promise<T>;
}
export declare const createHttpClient: (baseUrl: string, fetchImpl?: typeof fetch) => HttpClient;
