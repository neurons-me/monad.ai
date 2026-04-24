"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rebuildProjectedNamespaceClaims = rebuildProjectedNamespaceClaims;
exports.getClaim = getClaim;
exports.claimNamespace = claimNamespace;
exports.openNamespace = openNamespace;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../Blockchain/db");
const derive_1 = require("./derive");
const manager_1 = require("./manager");
const identity_1 = require("../namespace/identity");
const memoryStore_1 = require("./memoryStore");
function normalizeNamespace(raw) {
    return (0, identity_1.normalizeNamespaceIdentity)(raw);
}
function ensureClaimsSchema() {
    db_1.db.exec(`
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
    const info = db_1.db.prepare(`PRAGMA table_info(claims)`).all();
    const hasSecretCommitment = info.some((column) => column.name === "secretCommitment");
    if (!hasSecretCommitment) {
        db_1.db.exec(`ALTER TABLE claims ADD COLUMN secretCommitment TEXT`);
        db_1.db.exec(`UPDATE claims SET secretCommitment = '' WHERE secretCommitment IS NULL`);
    }
}
ensureClaimsSchema();
function materializeProjectedNamespaceClaim(namespace, timestamp) {
    const identity = (0, identity_1.parseNamespaceIdentityParts)(namespace);
    const hostNamespace = (0, identity_1.normalizeNamespaceRootName)(identity.host);
    const username = String(identity.username || "").trim().toLowerCase();
    const projectedNamespace = normalizeNamespace(namespace);
    if (!hostNamespace || !username || !projectedNamespace)
        return;
    (0, memoryStore_1.appendSemanticMemory)({
        namespace: hostNamespace,
        path: `users.${username}`,
        operator: "__",
        data: { __ptr: projectedNamespace },
        timestamp,
    });
}
function listProjectedNamespacePointers(path) {
    return db_1.db
        .prepare(`
      SELECT id, namespace, path, operator, data, hash, prevHash, signature, timestamp
      FROM semantic_memories
      WHERE path = ?
      ORDER BY id ASC
    `)
        .all(path);
}
function hasProjectedNamespacePointer(rootNamespace, username, projectedNamespace) {
    const path = `users.${username}`;
    const pointers = listProjectedNamespacePointers(path);
    return pointers.some((pointer) => {
        const pointerRoot = (0, identity_1.normalizeNamespaceRootName)(pointer.namespace);
        if (pointerRoot !== rootNamespace)
            return false;
        try {
            const payload = pointer.data;
            return String(payload?.__ptr || "").trim().toLowerCase() === projectedNamespace;
        }
        catch {
            return false;
        }
    });
}
function rebuildProjectedNamespaceClaims() {
    const claims = db_1.db
        .prepare(`
      SELECT namespace, createdAt
      FROM claims
      ORDER BY createdAt ASC
    `)
        .all();
    let inserted = 0;
    for (const claim of claims) {
        const projectedNamespace = normalizeNamespace(claim.namespace);
        const identity = (0, identity_1.parseNamespaceIdentityParts)(projectedNamespace);
        const rootNamespace = (0, identity_1.normalizeNamespaceRootName)(identity.host);
        const username = String(identity.username || "").trim().toLowerCase();
        if (!rootNamespace || !username || !projectedNamespace)
            continue;
        if (hasProjectedNamespacePointer(rootNamespace, username, projectedNamespace))
            continue;
        (0, memoryStore_1.appendSemanticMemory)({
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
function getClaim(namespace) {
    const ns = normalizeNamespace(namespace);
    if (!ns)
        return undefined;
    return db_1.db
        .prepare(`
      SELECT namespace, identityHash, secretCommitment, encryptedNoise, publicKey, createdAt, updatedAt
      FROM claims
      WHERE namespace = ?
    `)
        .get(ns);
}
function claimNamespace(input) {
    const namespace = normalizeNamespace(input.namespace);
    const secret = String(input.secret || "");
    const identityHash = String(input.identityHash || "").trim();
    const publicKey = String(input.publicKey || "").trim() || null;
    const privateKey = String(input.privateKey || "").trim() || null;
    if (!namespace)
        return { ok: false, error: "NAMESPACE_REQUIRED" };
    if (!secret)
        return { ok: false, error: "SECRET_REQUIRED" };
    if (!identityHash)
        return { ok: false, error: "IDENTITY_HASH_REQUIRED" };
    const exists = getClaim(namespace);
    if (exists)
        return { ok: false, error: "NAMESPACE_TAKEN" };
    const noise = crypto_1.default.randomBytes(32).toString("hex");
    const secretCommitment = (0, derive_1.deriveSecretCommitment)(namespace, secret);
    const unlockKey = (0, derive_1.deriveUnlockKey)(namespace, secret);
    const encryptedNoise = (0, derive_1.encryptNoise)(noise, unlockKey);
    const now = Date.now();
    let persistentClaim;
    try {
        const bundle = (0, manager_1.buildPersistentClaimBundle)({
            namespace,
            identityHash,
            publicKey,
            privateKey,
            issuedAt: now,
        });
        db_1.db.prepare(`
      INSERT INTO claims (namespace, identityHash, secretCommitment, encryptedNoise, publicKey, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(namespace, identityHash, secretCommitment, encryptedNoise, bundle.summary.claim.publicKey.key, now, now);
        persistentClaim = (0, manager_1.writePersistentClaimBundle)(bundle);
        materializeProjectedNamespaceClaim(namespace, now);
    }
    catch (error) {
        try {
            db_1.db.prepare(`DELETE FROM claims WHERE namespace = ?`).run(namespace);
        }
        catch {
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
        record: record ||
            {
                namespace,
                identityHash,
                secretCommitment,
                encryptedNoise,
                publicKey: persistentClaim.claim.publicKey.key,
                createdAt: now,
                updatedAt: now,
            },
    };
}
function openNamespace(input) {
    const namespace = normalizeNamespace(input.namespace);
    const secret = String(input.secret || "");
    const identityHash = String(input.identityHash || "").trim();
    if (!namespace)
        return { ok: false, error: "NAMESPACE_REQUIRED" };
    if (!secret)
        return { ok: false, error: "SECRET_REQUIRED" };
    if (!identityHash)
        return { ok: false, error: "IDENTITY_HASH_REQUIRED" };
    const record = getClaim(namespace);
    if (!record)
        return { ok: false, error: "CLAIM_NOT_FOUND" };
    if (identityHash !== record.identityHash) {
        return { ok: false, error: "IDENTITY_MISMATCH" };
    }
    const secretCommitment = (0, derive_1.deriveSecretCommitment)(namespace, secret);
    if (!record.secretCommitment || secretCommitment !== record.secretCommitment) {
        return { ok: false, error: "CLAIM_VERIFICATION_FAILED" };
    }
    try {
        const unlockKey = (0, derive_1.deriveUnlockKey)(namespace, secret);
        const noise = (0, derive_1.decryptNoise)(record.encryptedNoise, unlockKey);
        return { ok: true, record, noise };
    }
    catch {
        return { ok: false, error: "NOISE_DECRYPT_FAILED" };
    }
}
