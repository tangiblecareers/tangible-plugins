/**
 * Exact match, then unique prefix, then an ambiguity error naming the
 * candidates. Shared by the machine's problem selection and the detail gate's
 * content-unit and skill resolution, so those three cannot drift apart.
 */
export const byName = (items, label, needle, what) => {
    const n = needle.trim().toLowerCase();
    const isMatch = (i) => label(i).toLowerCase() === n || i.id.toLowerCase() === n;
    const isPrefix = (i) => label(i).toLowerCase().startsWith(n) || i.id.toLowerCase().startsWith(n);
    const exact = items.filter(isMatch);
    if (exact.length === 1)
        return exact[0];
    const pre = items.filter(isPrefix);
    if (pre.length === 1)
        return pre[0];
    const all = items.map(label).join(', ');
    if (pre.length > 1) {
        throw new Error(`"${needle}" matches more than one ${what}: ${pre.map(label).join(', ')}`);
    }
    throw new Error(`No ${what} matching "${needle}". Available: ${all}`);
};
