export const call = (http, auth, opts) => auth.withBusiness((token) => http.request({ ...opts, token }));
