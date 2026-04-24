import crypto from "crypto";
import { db } from "../Blockchain/db";
import { decryptNoise, deriveSecretCommitment, deriveUnlockKey, encryptNoise } from "./derive";
import { buildPersistentClaimBundle, writePersistentClaimBundle } from "./manager";
import { normalizeNamespaceIdentity, normalizeNamespaceRootName, parseNamespaceIdentityParts } from "../namespace/identity";
import { appendSemanticMemory } from "./memoryStore";
import type { SemanticMemoryRow } from "./memoryStore";
import type {
  ClaimNamespaceResult,
  ClaimRecord,
  NamespaceClaimInput,
  NamespaceOpenInput,
  OpenNamespaceResult,
  PersistentClaimSummary,
} from "./types";

function normalizeNamespace(raw: string) {
  return normalizeNamespaceIdentity(raw);
}

function ensureClaimsSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS claims (
      namespace TEXT PRIMARY KEY,
      identityHash TEXT NOT NULL,
      secretCommitment TEXT NOT NULL DEFAULT '',
      encryptedNoise TEXT NOT NULL,
      publicKey TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
  `);

  const info = db.prepare(`PRAGMA table_info(claims)`).all() as Array<{ name: string }>;
  const hasSecretCommitment = info.some((column) => column.name === "secretCommitment");
  if (!hasSecretCommitment) {
    db.exec(`ALTER TABLE claims ADD COLUMN secretCommitment TEXT`);
    db.exec(`UPDATE claims SET secretCommitment = '' WHERE secretCommitment IS NULL`);
  }
}

ensureClaimsSchema();

function materializeProjectedNamespaceClaim(namespace: string, timestamp: number) {
  const identity = parseNamespaceIdentityParts(namespace);
  const hostNamespace = normalizeNamespaceRootName(identity.host);
  const username = String(identity.username || "").trim().toLowerCase();
  const projectedNamespace = normalizeNamespace(namespace);

  if (!hostNamespace || !username || !projectedNamespace) return;

  appendSemanticMemory({
    namespace: hostNamespace,
    path: `users.${username}`,
    operator: "__",
    data: { __ptr: projectedNamespace },
    timestamp,
  });
}

function listProjectedNamespacePointers(path: string): SemanticMemoryRow[] {
  return db
    .prepare(
      `
      SELECT id, namespace, path, operator, data, hash, prevHash, signature, timestamp
      FROM semantic_memories
      WHERE path = ?
      ORDER BY id ASC
    `,
    )
    .all(path) as SemanticMemoryRow[];
}

function hasProjectedNamespacePointer(rootNamespace: string, username: string, projectedNamespace: string): boolean {
  const path = `users.${username}`;
  const pointers = listProjectedNamespacePointers(path);
  return pointers.some((pointer) => {
    const pointerRoot = normalizeNamespaceRootName(pointer.namespace);
    if (pointerRoot !== rootNamespace) return false;

    try {
      const payload = pointer.data as { __ptr?: string } | null;
      return String(payload?.__ptr || "").trim().toLowerCase() === projectedNamespace;
    } catch {
      return false;
    }
  });
}

export function rebuildProjectedNamespaceClaims(): number {
  const claims = db
    .prepare(
      `
      SELECT namespace, createdAt
      FROM claims
      ORDER BY createdAt ASC
    `,
    )
    .all() as Array<{ namespace: string; createdAt: number }>;

  let inserted = 0;

  for (const claim of claims) {
    const projectedNamespace = normalizeNamespace(claim.namespace);
    const identity = parseNamespaceIdentityParts(projectedNamespace);
    const rootNamespace = normalizeNamespaceRootName(identity.host);
    const username = String(identity.username || "").trim().toLowerCase();

    if (!rootNamespace || !username || !projectedNamespace) continue;
    if (hasProjectedNamespacePointer(rootNamespace, username, projectedNamespace)) continue;

    appendSemanticMemory({
      namespace: rootNamespace,
      path: `users.${username}`,
      operator: "__",
      data: { __ptr: projectedNamespace },
      timestamp: Number(claim.createdAt || Date.now()),
    });
    inserted += 1;
  }

  return inserted;
}

export function getClaim(namespace: string): ClaimRecord | undefined {
  const ns = normalizeNamespace(namespace);
  if (!ns) return undefined;
  return db
    .prepare(
      `
      SELECT namespace, identityHash, secretCommitment, encryptedNoise, publicKey, createdAt, updatedAt
      FROM claims
      WHERE namespace = ?
    `
    )
    .get(ns) as ClaimRecord | undefined;
}

export function claimNamespace(input: NamespaceClaimInput): ClaimNamespaceResult {
  const namespace = normalizeNamespace(input.namespace);
  const secret = String(input.secret || "");
  const identityHash = String(input.identityHash || "").trim();
  const publicKey = String(input.publicKey || "").trim() || null;
  const privateKey = String(input.privateKey || "").trim() || null;

  if (!namespace) return { ok: false, error: "NAMESPACE_REQUIRED" };
  if (!secret) return { ok: false, error: "SECRET_REQUIRED" };
  if (!identityHash) return { ok: false, error: "IDENTITY_HASH_REQUIRED" };

  const exists = getClaim(namespace);
  if (exists) return { ok: false, error: "NAMESPACE_TAKEN" };

  const noise = crypto.randomBytes(32).toString("hex");
  const secretCommitment = deriveSecretCommitment(namespace, secret);
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
      INSERT INTO claims (namespace, identityHash, secretCommitment, encryptedNoise, publicKey, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      namespace,
      identityHash,
      secretCommitment,
      encryptedNoise,
      bundle.summary.claim.publicKey.key,
      now,
      now,
    );

    persistentClaim = writePersistentClaimBundle(bundle);
    materializeProjectedNamespaceClaim(namespace, now);
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
        secretCommitment,
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
  const identityHash = String(input.identityHash || "").trim();

  if (!namespace) return { ok: false, error: "NAMESPACE_REQUIRED" };
  if (!secret) return { ok: false, error: "SECRET_REQUIRED" };
  if (!identityHash) return { ok: false, error: "IDENTITY_HASH_REQUIRED" };

  const record = getClaim(namespace);
  if (!record) return { ok: false, error: "CLAIM_NOT_FOUND" };

  if (identityHash !== record.identityHash) {
    return { ok: false, error: "IDENTITY_MISMATCH" };
  }

  const secretCommitment = deriveSecretCommitment(namespace, secret);
  if (!record.secretCommitment || secretCommitment !== record.secretCommitment) {
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
