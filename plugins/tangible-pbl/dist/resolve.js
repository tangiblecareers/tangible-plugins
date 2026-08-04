/** GET user/business — frontend/src/api/endpoints.ts:168. */
export const listBusinesses = async (http, auth) => auth.withUser(async (token) => {
    const payload = await http.request({ method: 'GET', path: 'user/business', token });
    if (Array.isArray(payload))
        return payload;
    return payload?.rows ?? [];
});
const names = (list) => list.map((b) => b.name).join(', ');
export const resolveBusiness = async (http, auth, name) => {
    const all = await listBusinesses(http, auth);
    const needle = name.trim().toLowerCase();
    const exact = all.filter((b) => b.name.toLowerCase() === needle);
    if (exact.length === 1)
        return exact[0];
    const prefixed = all.filter((b) => b.name.toLowerCase().startsWith(needle));
    if (prefixed.length === 1)
        return prefixed[0];
    if (prefixed.length > 1) {
        throw new Error(`"${name}" matches more than one business: ${names(prefixed)}. Be more specific.`);
    }
    throw new Error(`No business matching "${name}". Available: ${names(all)}`);
};
