"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPersistentClaimPath = getPersistentClaimPath;
exports.buildPersistentClaimBundle = buildPersistentClaimBundle;
exports.writePersistentClaimBundle = writePersistentClaimBundle;
exports.loadPersistentClaim = loadPersistentClaim;
exports.verifyPersistentClaim = verifyPersistentClaim;
exports.deletePersistentClaim = deletePersistentClaim;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const identity_1 = require("../namespace/identity");
function stableStringify(value) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    const obj = value;
    const keys = Object.keys(obj).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
    return `{${entries.join(",")}}`;
}
function normalizeNamespace(raw) {
    return (0, identity_1.normalizeNamespaceIdentity)(raw);
}
function ensureDirectory(dirPath) {
    fs_1.default.mkdirSync(dirPath, { recursive: true });
}
function sanitizeNamespaceFilename(namespace) {
    return normalizeNamespace(namespace).replace(/[^a-z0-9._-]/g, "_");
}
function normalizePem(key, type) {
    if (type === "public") {
        return key.export({ type: "spki", format: "pem" }).toString();
    }
    return key.export({ type: "pkcs8", format: "pem" }).toString();
}
function normalizePublicPem(raw) {
    try {
        const key = crypto_1.default.createPublicKey(String(raw || "").trim());
        return {
            pem: normalizePem(key, "public"),
            alg: key.asymmetricKeyType || "unknown",
        };
    }
    catch {
        throw new Error("CLAIM_KEY_INVALID");
    }
}
function normalizePrivatePem(raw) {
    try {
        const key = crypto_1.default.createPrivateKey(String(raw || "").trim());
        const publicKey = crypto_1.default.createPublicKey(key);
        return {
            privatePem: normalizePem(key, "private"),
            publicPem: normalizePem(publicKey, "public"),
            alg: key.asymmetricKeyType || publicKey.asymmetricKeyType || "unknown",
        };
    }
    catch {
        throw new Error("CLAIM_KEY_INVALID");
    }
}
function generateEd25519Keypair() {
    const pair = crypto_1.default.generateKeyPairSync("ed25519");
    return {
        privatePem: normalizePem(pair.privateKey, "private"),
        publicPem: normalizePem(pair.publicKey, "public"),
        alg: "ed25519",
    };
}
function createKeyKid(publicKeyPem) {
    const digest = crypto_1.default
        .createHash("sha256")
        .update(String(publicKeyPem || "").trim())
        .digest("hex");
    return `sha256:${digest}`;
}
function buildPublicKeyRecord(pem, alg, source) {
    return {
        kid: createKeyKid(pem),
        alg,
        key: pem,
        source,
    };
}
function signPayload(privateKeyPem, payload) {
    const privateKey = crypto_1.default.createPrivateKey(privateKeyPem);
    const keyType = privateKey.asymmetricKeyType || "unknown";
    const data = Buffer.from(payload);
    if (keyType === "ed25519" || keyType === "ed448") {
        return {
            alg: keyType,
            value: crypto_1.default.sign(null, data, privateKey).toString("base64"),
            encoding: "base64",
        };
    }
    return {
        alg: `${keyType}-sha256`,
        value: crypto_1.default.sign("sha256", data, privateKey).toString("base64"),
        encoding: "base64",
    };
}
function verifyPayloadSignature(claim) {
    const { signature, ...unsigned } = claim;
    const data = Buffer.from(stableStringify(unsigned));
    const sig = Buffer.from(String(signature.value || ""), "base64");
    const proofKey = crypto_1.default.createPublicKey(claim.proofKey.key);
    const keyType = proofKey.asymmetricKeyType || claim.proofKey.alg;
    if (keyType === "ed25519" || keyType === "ed448") {
        return crypto_1.default.verify(null, data, proofKey, sig);
    }
    return crypto_1.default.verify("sha256", data, proofKey, sig);
}
function getClaimStorePaths() {
    const claimsDir = path_1.default.resolve(process.cwd(), String(process.env.MONAD_CLAIM_DIR || "env/claims"));
    return {
        claimsDir,
        keysDir: path_1.default.join(claimsDir, ".keys"),
    };
}
function getPersistentClaimPath(namespace) {
    const { claimsDir } = getClaimStorePaths();
    return path_1.default.join(claimsDir, `${sanitizeNamespaceFilename(namespace)}.json`);
}
function getPersistentClaimPrivateKeyPath(namespace) {
    const { keysDir } = getClaimStorePaths();
    return path_1.default.join(keysDir, `${sanitizeNamespaceFilename(namespace)}.private.pem`);
}
function resolveStoredProofKey(namespace) {
    const privateKeyPath = getPersistentClaimPrivateKeyPath(namespace);
    if (!fs_1.default.existsSync(privateKeyPath)) {
        return null;
    }
    const stored = normalizePrivatePem(fs_1.default.readFileSync(privateKeyPath, "utf8"));
    return {
        privateKeyPath,
        privatePem: stored.privatePem,
        publicPem: stored.publicPem,
        alg: stored.alg,
        source: "stored",
    };
}
function resolveClaimKeys(input) {
    const requestedPublicKey = String(input.publicKey || "").trim();
    const requestedPrivateKey = String(input.privateKey || "").trim();
    const storedProofKey = resolveStoredProofKey(input.namespace);
    if (requestedPrivateKey) {
        const normalized = normalizePrivatePem(requestedPrivateKey);
        if (requestedPublicKey) {
            const normalizedPublic = normalizePublicPem(requestedPublicKey);
            if (normalizedPublic.pem !== normalized.publicPem) {
                throw new Error("CLAIM_KEYPAIR_MISMATCH");
            }
        }
        return {
            namespacePublicKey: buildPublicKeyRecord(normalized.publicPem, normalized.alg, requestedPublicKey ? "provided" : "provided"),
            proofKey: buildPublicKeyRecord(normalized.publicPem, normalized.alg, "provided"),
            proofPrivateKeyPem: normalized.privatePem,
            proofPrivateKeyPath: getPersistentClaimPrivateKeyPath(input.namespace),
            persistPrivateKey: true,
        };
    }
    if (requestedPublicKey) {
        const normalizedPublic = normalizePublicPem(requestedPublicKey);
        if (storedProofKey && storedProofKey.publicPem === normalizedPublic.pem) {
            return {
                namespacePublicKey: buildPublicKeyRecord(normalizedPublic.pem, normalizedPublic.alg, "provided"),
                proofKey: buildPublicKeyRecord(storedProofKey.publicPem, storedProofKey.alg, "stored"),
                proofPrivateKeyPem: storedProofKey.privatePem,
                proofPrivateKeyPath: storedProofKey.privateKeyPath,
                persistPrivateKey: false,
            };
        }
        if (storedProofKey) {
            return {
                namespacePublicKey: buildPublicKeyRecord(normalizedPublic.pem, normalizedPublic.alg, "provided"),
                proofKey: buildPublicKeyRecord(storedProofKey.publicPem, storedProofKey.alg, "stored"),
                proofPrivateKeyPem: storedProofKey.privatePem,
                proofPrivateKeyPath: storedProofKey.privateKeyPath,
                persistPrivateKey: false,
            };
        }
        const generated = generateEd25519Keypair();
        return {
            namespacePublicKey: buildPublicKeyRecord(normalizedPublic.pem, normalizedPublic.alg, "provided"),
            proofKey: buildPublicKeyRecord(generated.publicPem, generated.alg, "generated"),
            proofPrivateKeyPem: generated.privatePem,
            proofPrivateKeyPath: getPersistentClaimPrivateKeyPath(input.namespace),
            persistPrivateKey: true,
        };
    }
    if (storedProofKey) {
        return {
            namespacePublicKey: buildPublicKeyRecord(storedProofKey.publicPem, storedProofKey.alg, "stored"),
            proofKey: buildPublicKeyRecord(storedProofKey.publicPem, storedProofKey.alg, "stored"),
            proofPrivateKeyPem: storedProofKey.privatePem,
            proofPrivateKeyPath: storedProofKey.privateKeyPath,
            persistPrivateKey: false,
        };
    }
    const generated = generateEd25519Keypair();
    return {
        namespacePublicKey: buildPublicKeyRecord(generated.publicPem, generated.alg, "generated"),
        proofKey: buildPublicKeyRecord(generated.publicPem, generated.alg, "generated"),
        proofPrivateKeyPem: generated.privatePem,
        proofPrivateKeyPath: getPersistentClaimPrivateKeyPath(input.namespace),
        persistPrivateKey: true,
    };
}
function buildPersistentClaimBundle(input) {
    const namespace = normalizeNamespace(input.namespace);
    const identityHash = String(input.identityHash || "").trim();
    const issuedAt = Number(input.issuedAt || Date.now());
    const claimPath = getPersistentClaimPath(namespace);
    const resolved = resolveClaimKeys({
        namespace,
        publicKey: input.publicKey,
        privateKey: input.privateKey,
    });
    const unsignedClaim = {
        kind: "PersistentClaimV1",
        version: 1,
        namespace,
        identityHash,
        publicKey: resolved.namespacePublicKey,
        proofKey: resolved.proofKey,
        issuedAt,
    };
    const signature = signPayload(resolved.proofPrivateKeyPem, stableStringify(unsignedClaim));
    const claim = {
        ...unsignedClaim,
        signature,
    };
    if (!verifyPayloadSignature(claim)) {
        throw new Error("CLAIM_PERSIST_FAILED");
    }
    return {
        summary: {
            claimPath,
            claim,
        },
        privateKeyPath: resolved.proofPrivateKeyPath,
        privateKeyPem: resolved.proofPrivateKeyPem,
        persistPrivateKey: resolved.persistPrivateKey,
    };
}
function writePersistentClaimBundle(bundle) {
    const { claimsDir, keysDir } = getClaimStorePaths();
    ensureDirectory(claimsDir);
    ensureDirectory(keysDir);
    try {
        if (bundle.privateKeyPath && bundle.privateKeyPem && bundle.persistPrivateKey) {
            fs_1.default.writeFileSync(bundle.privateKeyPath, bundle.privateKeyPem, { mode: 0o600 });
            fs_1.default.chmodSync(bundle.privateKeyPath, 0o600);
        }
        fs_1.default.writeFileSync(bundle.summary.claimPath, `${JSON.stringify(bundle.summary.claim, null, 2)}\n`, "utf8");
        return bundle.summary;
    }
    catch (error) {
        try {
            if (fs_1.default.existsSync(bundle.summary.claimPath)) {
                fs_1.default.rmSync(bundle.summary.claimPath, { force: true });
            }
        }
        catch {
        }
        try {
            if (bundle.privateKeyPath && bundle.persistPrivateKey && fs_1.default.existsSync(bundle.privateKeyPath)) {
                fs_1.default.rmSync(bundle.privateKeyPath, { force: true });
            }
        }
        catch {
        }
        throw error;
    }
}
function loadPersistentClaim(namespace) {
    const claimPath = getPersistentClaimPath(namespace);
    if (!fs_1.default.existsSync(claimPath))
        return null;
    const raw = fs_1.default.readFileSync(claimPath, "utf8");
    const claim = JSON.parse(raw);
    return {
        claimPath,
        claim,
    };
}
function verifyPersistentClaim(namespace) {
    try {
        const loaded = loadPersistentClaim(namespace);
        if (!loaded)
            return false;
        return verifyPayloadSignature(loaded.claim);
    }
    catch {
        return false;
    }
}
function deletePersistentClaim(namespace) {
    const claimPath = getPersistentClaimPath(namespace);
    const privateKeyPath = getPersistentClaimPrivateKeyPath(namespace);
    try {
        if (fs_1.default.existsSync(claimPath)) {
            fs_1.default.rmSync(claimPath, { force: true });
        }
    }
    catch {
    }
    try {
        if (fs_1.default.existsSync(privateKeyPath)) {
            fs_1.default.rmSync(privateKeyPath, { force: true });
        }
    }
    catch {
    }
}
