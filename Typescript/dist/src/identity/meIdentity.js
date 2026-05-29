import ME from "this.me";
const IDENTITY_HASH_PATTERN = /^[0-9a-f]{64}$/;
export function normalizeMeIdentityHash(input) {
    const value = String(input || "").trim().toLowerCase();
    return IDENTITY_HASH_PATTERN.test(value) ? value : undefined;
}
export function resolveMeIdentityHash(seed) {
    const value = String(seed || "").trim();
    if (!value)
        return undefined;
    try {
        const runtime = new ME(value);
        return normalizeMeIdentityHash(runtime?.["!"]?.identity?.()?.hash);
    }
    catch {
        return undefined;
    }
}
export function resolveMeIdentityHashFromEnv(env) {
    return resolveMeIdentityHash(env.SEED || env.ME_SEED);
}
