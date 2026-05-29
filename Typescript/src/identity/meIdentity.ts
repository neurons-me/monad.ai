import ME from "this.me";

const IDENTITY_HASH_PATTERN = /^[0-9a-f]{64}$/;

export function normalizeMeIdentityHash(input: unknown): string | undefined {
  const value = String(input || "").trim().toLowerCase();
  return IDENTITY_HASH_PATTERN.test(value) ? value : undefined;
}

export function resolveMeIdentityHash(seed: unknown): string | undefined {
  const value = String(seed || "").trim();
  if (!value) return undefined;

  try {
    const runtime = new (ME as any)(value);
    return normalizeMeIdentityHash((runtime as any)?.["!"]?.identity?.()?.hash);
  } catch {
    return undefined;
  }
}

export function resolveMeIdentityHashFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  return resolveMeIdentityHash(env.SEED || env.ME_SEED);
}
