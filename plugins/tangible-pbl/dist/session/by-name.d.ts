/**
 * Exact match, then unique prefix, then an ambiguity error naming the
 * candidates. Shared by the machine's problem selection and the detail gate's
 * content-unit and skill resolution, so those three cannot drift apart.
 */
export declare const byName: <T extends {
    id: string;
}>(items: T[], label: (t: T) => string, needle: string, what: string) => T;
