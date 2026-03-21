import crypto from "crypto";
import { db } from "../Blockchain/db";
import { decryptNoise, deriveIdentityHash, deriveUnlockKey, encryptNoise } from "./derive";
import { buildPersistentClaimBundle, writePersistentClaimBundle } from "./manager";
import type {
  ClaimNamespaceResult,
  ClaimRecord,
  NamespaceClaimInput,
  NamespaceOpenInput,
  OpenNamespaceResult,
  PersistentClaimSummary,
} from "./types";

function normalizeNamespace(raw: string) {
  return String(raw || "").trim().toLowerCase();
}

export function getClaim(namespace: string): ClaimRecord | undefined {
  const ns = normalizeNamespace(namespace);
  if (!ns) return undefined;
  return db
    .prepare(
      `
      SELECT namespace, identityHash, encryptedNoise, publicKey, createdAt, updatedAt
      FROM claims
      WHERE namespace = ?
    `
    )
    .get(ns) as ClaimRecord | undefined;
}

export function claimNamespace(input: NamespaceClaimInput): ClaimNamespaceResult {
  const namespace = normalizeNamespace(input.namespace);
  const secret = String(input.secret || "");
  const publicKey = String(input.publicKey || "").trim() || null;
  const privateKey = String(input.privateKey || "").trim() || null;

  if (!namespace) return { ok: false, error: "NAMESPACE_REQUIRED" };
  if (!secret) return { ok: false, error: "SECRET_REQUIRED" };

  const exists = getClaim(namespace);
  if (exists) return { ok: false, error: "NAMESPACE_TAKEN" };

  const noise = crypto.randomBytes(32).toString("hex");
  const identityHash = deriveIdentityHash(namespace, secret);
  const unlockKey = deriveUnlockKey(namespace, secret);
  const encryptedNoise = encryptNoise(noise, unlockKey);
  const now = Date.now();
  let persistentClaim: PersistentClaimSummary;

  try {
    const bundle = buildPersistentClaimBundle({
      namespace,
      identityHash,
      publicKey,
      privateKey,
      issuedAt: now,
    });

    db.prepare(
      `
      INSERT INTO claims (namespace, identityHash, encryptedNoise, publicKey, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      namespace,
      identityHash,
      encryptedNoise,
      bundle.summary.claim.publicKey.key,
      now,
      now,
    );

    persistentClaim = writePersistentClaimBundle(bundle);
  } catch (error) {
    try {
      db.prepare(`DELETE FROM claims WHERE namespace = ?`).run(namespace);
    } catch {
    }

    const code = error instanceof Error ? error.message : String(error);
    if (code === "CLAIM_KEYPAIR_MISMATCH") {
      return { ok: false, error: "CLAIM_KEYPAIR_MISMATCH" };
    }
    if (code === "CLAIM_KEY_INVALID") {
      return { ok: false, error: "CLAIM_KEY_INVALID" };
    }
    return { ok: false, error: "CLAIM_PERSIST_FAILED" };
  }

  const record = getClaim(namespace);
  return {
    ok: true,
    noise,
    persistentClaim,
    record:
      record ||
      ({
        namespace,
        identityHash,
        encryptedNoise,
        publicKey: persistentClaim.claim.publicKey.key,
        createdAt: now,
        updatedAt: now,
      } satisfies ClaimRecord),
  };
}

export function openNamespace(input: NamespaceOpenInput): OpenNamespaceResult {
  const namespace = normalizeNamespace(input.namespace);
  const secret = String(input.secret || "");

  if (!namespace) return { ok: false, error: "NAMESPACE_REQUIRED" };
  if (!secret) return { ok: false, error: "SECRET_REQUIRED" };

  const record = getClaim(namespace);
  if (!record) return { ok: false, error: "CLAIM_NOT_FOUND" };

  const identityHash = deriveIdentityHash(namespace, secret);
  if (identityHash !== record.identityHash) {
    return { ok: false, error: "CLAIM_VERIFICATION_FAILED" };
  }

  try {
    const unlockKey = deriveUnlockKey(namespace, secret);
    const noise = decryptNoise(record.encryptedNoise, unlockKey);
    return { ok: true, record, noise };
  } catch {
    return { ok: false, error: "NOISE_DECRYPT_FAILED" };
  }
}
