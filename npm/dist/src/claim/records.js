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
const this_me_1 = require("this.me");
const manager_js_1 = require("../kernel/manager.js");
const manager_js_2 = require("../kernel/manager.js");
const derive_js_1 = require("./derive.js");
const manager_js_3 = require("./manager.js");
const identity_js_1 = require("../namespace/identity.js");
const memoryStore_js_1 = require("./memoryStore.js");
const CLAIM_PROOF_MAX_AGE_MS = 5 * 60 * 1000;
function normalizeNamespace(raw) {
    return (0, identity_js_1.normalizeNamespaceIdentity)(raw);
}
// Encode namespace for use as a kernel path segment (dots → __)
function nsKey(namespace) {
    return namespace.replace(/\./g, "__");
}
function claimPath(namespace) {
    return `daemon.claims.${nsKey(namespace)}`;
}
// Navigate proxy chain by dot-path and return the leaf proxy
function nav(root, path) {
    return path.split(".").reduce((proxy, key) => proxy[key], root);
}
function kernelGet(path) {
    const kernelRead = (0, manager_js_1.getKernel)();
    const result = kernelRead(path);
    return result === undefined || result === null ? undefined : result;
}
function kernelSet(path, value) {
    nav((0, manager_js_1.getKernel)(), path)(value);
}
function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function parseClaimProofPayload(proof) {
    const rawMessage = String(proof.message || "");
    if (!rawMessage)
        return null;
    let parsed;
    try {
        parsed = JSON.parse(rawMessage);
    }
    catch {
        return null;
    }
    if (!isPlainObject(parsed))
        return null;
    const canonical = (0, this_me_1.normalizeProofMessage)(parsed);
    if (canonical !== rawMessage)
        return null;
    const identityHash = String(parsed.identityHash || "").trim();
    const expression = String(parsed.expression || "").trim();
    const namespace = normalizeNamespace(String(parsed.namespace || ""));
    const rootNamespace = (0, identity_js_1.normalizeNamespaceRootName)(String(parsed.rootNamespace || ""));
    const challenge = parsed.challenge == null ? null : String(parsed.challenge);
    const timestamp = Number(parsed.timestamp || 0);
    if (!identityHash || !expression || !namespace || !rootNamespace || !Number.isFinite(timestamp) || timestamp <= 0) {
        return null;
    }
    return {
        identityHash,
        expression,
        namespace,
        rootNamespace,
        challenge,
        timestamp,
    };
}
function normalizeProofTimestamp(proof, payload) {
    const direct = Number(proof.timestamp ?? 0);
    if (Number.isFinite(direct) && direct > 0)
        return direct;
    return payload.timestamp;
}
function enforceClaimProofWindow(timestamp) {
    return Math.abs(Date.now() - timestamp) <= CLAIM_PROOF_MAX_AGE_MS;
}
function rawEd25519PublicKeyToPem(rawPublicKey) {
    const raw = Buffer.from(String(rawPublicKey || "").replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(rawPublicKey || "").length / 4) * 4, "="), "base64");
    if (raw.length !== 32) {
        throw new Error("PROOF_INVALID");
    }
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const spkiDer = Buffer.concat([spkiPrefix, raw]);
    const publicKey = crypto_1.default.createPublicKey({
        key: spkiDer,
        format: "der",
        type: "spki",
    });
    return publicKey.export({ type: "spki", format: "pem" }).toString();
}
async function resolveClaimIdentity(input) {
    const proof = input.proof;
    if (!proof) {
        const identityHash = String(input.identityHash || "").trim();
        if (!identityHash)
            return { ok: false, error: "IDENTITY_HASH_REQUIRED" };
        return { ok: true, identityHash, publicKeyPem: String(input.publicKey || "").trim() || null };
    }
    const payload = parseClaimProofPayload(proof);
    if (!payload)
        return { ok: false, error: "PROOF_MESSAGE_INVALID" };
    if (payload.namespace !== normalizeNamespace(input.namespace)) {
        return { ok: false, error: "PROOF_NAMESPACE_MISMATCH" };
    }
    const proofTimestamp = normalizeProofTimestamp(proof, payload);
    if (!enforceClaimProofWindow(proofTimestamp)) {
        return { ok: false, error: "PROOF_TIMESTAMP_INVALID" };
    }
    const verified = await (0, this_me_1.verifyEd25519Signature)(String(proof.publicKey || ""), proof.message, String(proof.signature || ""));
    if (!verified)
        return { ok: false, error: "PROOF_INVALID" };
    try {
        return {
            ok: true,
            identityHash: payload.identityHash,
            publicKeyPem: rawEd25519PublicKeyToPem(String(proof.publicKey || "")),
        };
    }
    catch {
        return { ok: false, error: "PROOF_INVALID" };
    }
}
function materializeProjectedNamespaceClaim(namespace, _timestamp) {
    const identity = (0, identity_js_1.parseNamespaceIdentityParts)(namespace);
    const hostNamespace = (0, identity_js_1.normalizeNamespaceRootName)(identity.host);
    const username = String(identity.username || "").trim().toLowerCase();
    if (!hostNamespace || !username)
        return;
    kernelSet(`daemon.users.${nsKey(hostNamespace)}.${username}`, { __ptr: namespace });
    (0, memoryStore_js_1.appendSemanticMemory)({
        namespace: hostNamespace,
        path: `users.${username}`,
        operator: "__",
        data: { __ptr: namespace },
        timestamp: _timestamp,
    });
}
function rebuildProjectedNamespaceClaims() {
    // Kernel state is always consistent — no rebuild needed
    return 0;
}
function getClaim(namespace) {
    const ns = normalizeNamespace(namespace);
    if (!ns)
        return undefined;
    return kernelGet(claimPath(ns));
}
async function claimNamespace(input) {
    const namespace = normalizeNamespace(input.namespace);
    const secret = String(input.secret || "");
    const resolved = await resolveClaimIdentity(input);
    const identityHash = resolved.ok ? resolved.identityHash : "";
    const publicKey = resolved.ok ? resolved.publicKeyPem : null;
    const privateKey = String(input.privateKey || "").trim() || null;
    if (!namespace)
        return { ok: false, error: "NAMESPACE_REQUIRED" };
    if (!secret)
        return { ok: false, error: "SECRET_REQUIRED" };
    if (!resolved.ok)
        return { ok: false, error: resolved.error };
    const exists = getClaim(namespace);
    if (exists)
        return { ok: false, error: "NAMESPACE_TAKEN" };
    const noise = crypto_1.default.randomBytes(32).toString("hex");
    const secretCommitment = (0, derive_js_1.deriveSecretCommitment)(namespace, secret);
    const unlockKey = (0, derive_js_1.deriveUnlockKey)(namespace, secret);
    const encryptedNoise = (0, derive_js_1.encryptNoise)(noise, unlockKey);
    const now = Date.now();
    let persistentClaim;
    try {
        const bundle = (0, manager_js_3.buildPersistentClaimBundle)({
            namespace,
            identityHash,
            publicKey,
            privateKey,
            issuedAt: now,
        });
        const record = {
            namespace,
            identityHash,
            secretCommitment,
            encryptedNoise,
            publicKey: bundle.summary.claim.publicKey.key,
            createdAt: now,
            updatedAt: now,
        };
        kernelSet(claimPath(namespace), record);
        persistentClaim = (0, manager_js_3.writePersistentClaimBundle)(bundle);
        materializeProjectedNamespaceClaim(namespace, now);
        (0, manager_js_2.saveSnapshot)();
    }
    catch (error) {
        try {
            kernelSet(claimPath(namespace), undefined);
        }
        catch { }
        const code = error instanceof Error ? error.message : String(error);
        if (code === "CLAIM_KEYPAIR_MISMATCH")
            return { ok: false, error: "CLAIM_KEYPAIR_MISMATCH" };
        if (code === "CLAIM_KEY_INVALID")
            return { ok: false, error: "CLAIM_KEY_INVALID" };
        return { ok: false, error: "CLAIM_PERSIST_FAILED" };
    }
    const record = getClaim(namespace);
    return { ok: true, noise, persistentClaim, record };
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
    if (identityHash !== record.identityHash)
        return { ok: false, error: "IDENTITY_MISMATCH" };
    const secretCommitment = (0, derive_js_1.deriveSecretCommitment)(namespace, secret);
    if (!record.secretCommitment || secretCommitment !== record.secretCommitment) {
        return { ok: false, error: "CLAIM_VERIFICATION_FAILED" };
    }
    try {
        const unlockKey = (0, derive_js_1.deriveUnlockKey)(namespace, secret);
        const noise = (0, derive_js_1.decryptNoise)(record.encryptedNoise, unlockKey);
        return { ok: true, record, noise };
    }
    catch {
        return { ok: false, error: "NOISE_DECRYPT_FAILED" };
    }
}
