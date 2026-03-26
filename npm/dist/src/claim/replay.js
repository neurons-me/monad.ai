"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordMemory = recordMemory;
exports.getMemoriesForNamespace = getMemoriesForNamespace;
exports.isNamespaceWriteAuthorized = isNamespaceWriteAuthorized;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../Blockchain/db");
const identity_1 = require("../namespace/identity");
function normalizeNamespace(raw) {
    return (0, identity_1.normalizeNamespaceIdentity)(raw);
}
function safeParseJson(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return raw;
    }
}
function toStableJson(value) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => toStableJson(item)).join(",")}]`;
    }
    const obj = value;
    const keys = Object.keys(obj).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${toStableJson(obj[key])}`);
    return `{${entries.join(",")}}`;
}
function decodeSignature(rawSignature) {
    const sig = String(rawSignature || "").trim();
    if (!sig)
        return null;
    try {
        return Buffer.from(sig, "base64");
    }
    catch {
        // Fallback for clients that send hex signatures.
        try {
            return Buffer.from(sig, "hex");
        }
        catch {
            return null;
        }
    }
}
function stripWriteAuthFields(body) {
    const { signature, signedPayload, signatureEncoding, signatureFormat, ...rest } = body;
    return rest;
}
function verifySignature(publicKey, message, signature) {
    try {
        const key = crypto_1.default.createPublicKey(publicKey);
        const keyType = key.asymmetricKeyType || "";
        const payload = Buffer.from(message);
        if (keyType === "ed25519" || keyType === "ed448") {
            return crypto_1.default.verify(null, payload, key, signature);
        }
        const verifier = crypto_1.default.createVerify("SHA256");
        verifier.update(payload);
        verifier.end();
        return verifier.verify(key, signature);
    }
    catch {
        return false;
    }
}
db_1.db.exec(`
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  namespace TEXT NOT NULL,
  payload TEXT NOT NULL,
  identityHash TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_namespace_ts
ON memories(namespace, timestamp);
`);
function recordMemory(input) {
    const namespace = normalizeNamespace(input.namespace);
    if (!namespace)
        return;
    const timestamp = Number(input.timestamp || Date.now());
    const identityHash = String(input.identityHash || "").trim();
    const payload = JSON.stringify(input.payload ?? null);
    db_1.db.prepare(`
      INSERT INTO memories (namespace, payload, identityHash, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(namespace, payload, identityHash, timestamp);
}
function getMemoriesForNamespace(namespace) {
    const ns = normalizeNamespace(namespace);
    if (!ns)
        return [];
    const rows = db_1.db
        .prepare(`
      SELECT payload, identityHash, timestamp
      FROM memories
      WHERE namespace = ?
      ORDER BY timestamp ASC, id ASC
    `)
        .all(ns);
    return rows.map((row) => ({
        payload: safeParseJson(String(row.payload || "")),
        identityHash: String(row.identityHash || ""),
        timestamp: Number(row.timestamp || 0),
    }));
}
function isNamespaceWriteAuthorized(input) {
    const claimIdentityHash = String(input.claimIdentityHash || "").trim();
    if (!claimIdentityHash)
        return false;
    const body = input.body;
    if (!body || typeof body !== "object")
        return false;
    const bodyRecord = body;
    const bodyIdentityHash = String(bodyRecord.identityHash || "").trim();
    if (bodyIdentityHash && bodyIdentityHash === claimIdentityHash) {
        return true;
    }
    const publicKey = String(input.claimPublicKey || "").trim();
    const rawSignature = String(bodyRecord.signature || "").trim();
    if (!publicKey || !rawSignature) {
        return false;
    }
    const signature = decodeSignature(rawSignature);
    if (!signature)
        return false;
    const signedPayload = String(bodyRecord.signedPayload || "").trim();
    const message = signedPayload || toStableJson(stripWriteAuthFields(bodyRecord));
    return verifySignature(publicKey, message, signature);
}
