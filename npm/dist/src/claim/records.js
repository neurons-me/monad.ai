"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getClaim = getClaim;
exports.claimNamespace = claimNamespace;
exports.openNamespace = openNamespace;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../Blockchain/db");
const derive_1 = require("./derive");
function normalizeNamespace(raw) {
    return String(raw || "").trim().toLowerCase();
}
function getClaim(namespace) {
    const ns = normalizeNamespace(namespace);
    if (!ns)
        return undefined;
    return db_1.db
        .prepare(`
      SELECT namespace, identityHash, encryptedNoise, publicKey, createdAt, updatedAt
      FROM claims
      WHERE namespace = ?
    `)
        .get(ns);
}
function claimNamespace(input) {
    const namespace = normalizeNamespace(input.namespace);
    const secret = String(input.secret || "");
    const publicKey = String(input.publicKey || "").trim() || null;
    if (!namespace)
        return { ok: false, error: "NAMESPACE_REQUIRED" };
    if (!secret)
        return { ok: false, error: "SECRET_REQUIRED" };
    const exists = getClaim(namespace);
    if (exists)
        return { ok: false, error: "NAMESPACE_TAKEN" };
    const noise = crypto_1.default.randomBytes(32).toString("hex");
    const identityHash = (0, derive_1.deriveIdentityHash)(namespace, secret);
    const unlockKey = (0, derive_1.deriveUnlockKey)(namespace, secret);
    const encryptedNoise = (0, derive_1.encryptNoise)(noise, unlockKey);
    const now = Date.now();
    db_1.db.prepare(`
    INSERT INTO claims (namespace, identityHash, encryptedNoise, publicKey, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(namespace, identityHash, encryptedNoise, publicKey, now, now);
    const record = getClaim(namespace);
    return {
        ok: true,
        noise,
        record: record ||
            {
                namespace,
                identityHash,
                encryptedNoise,
                publicKey,
                createdAt: now,
                updatedAt: now,
            },
    };
}
function openNamespace(input) {
    const namespace = normalizeNamespace(input.namespace);
    const secret = String(input.secret || "");
    if (!namespace)
        return { ok: false, error: "NAMESPACE_REQUIRED" };
    if (!secret)
        return { ok: false, error: "SECRET_REQUIRED" };
    const record = getClaim(namespace);
    if (!record)
        return { ok: false, error: "CLAIM_NOT_FOUND" };
    const identityHash = (0, derive_1.deriveIdentityHash)(namespace, secret);
    if (identityHash !== record.identityHash) {
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
