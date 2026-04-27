"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSessionRouter = createSessionRouter;
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const memoryStore_1 = require("../claim/memoryStore");
const meTarget_1 = require("./meTarget");
const envelope_1 = require("./envelope");
const identity_1 = require("../namespace/identity");
const namespace_1 = require("./namespace");
function normalizeUsername(input) {
    return String(input || "").trim().toLowerCase();
}
function normalizeHostKey(input) {
    return String(input || "")
        .trim()
        .toLowerCase()
        .replace(/\.local$/i, "")
        .replace(/[^a-z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
}
function parseEndpointHost(input) {
    const raw = String(input || "").trim();
    if (!raw)
        return "";
    try {
        return String(new URL(raw).hostname || "").trim().toLowerCase();
    }
    catch {
        return raw
            .replace(/^https?:\/\//i, "")
            .split("/")[0]
            .split(":")[0]
            .trim()
            .toLowerCase();
    }
}
function isLoopbackishHost(host) {
    const normalized = String(host || "").trim().toLowerCase();
    return /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)$/.test(normalized);
}
function deriveHostLabel(input) {
    const label = normalizeHostKey(input.explicitLabel || "") ||
        normalizeHostKey(input.explicitHostname || "") ||
        (() => {
            const endpointHost = parseEndpointHost(String(input.localEndpoint || ""));
            if (!endpointHost || isLoopbackishHost(endpointHost))
                return "";
            return normalizeHostKey(endpointHost);
        })() ||
        normalizeHostKey(input.fingerprint);
    return label || "host";
}
function resolveSessionRootNamespace(req) {
    const resolved = (0, namespace_1.resolveNamespaceProjectionRoot)((0, namespace_1.resolveNamespace)(req));
    return String(resolved || "").trim().toLowerCase();
}
function resolveUserNamespace(req, username) {
    const root = resolveSessionRootNamespace(req);
    return (0, identity_1.composeProjectedNamespace)(username, root);
}
function computeSessionExpiry(iatMs, ttlSeconds) {
    const ttl = Number.isFinite(ttlSeconds) ? Number(ttlSeconds) : 3600;
    const boundedTtl = Math.max(60, Math.min(60 * 60 * 24 * 30, ttl));
    return iatMs + boundedTtl * 1000;
}
function signSessionToken(session) {
    const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
    const secret = process.env.SESSION_SIGNING_SECRET || "monad-dev-secret";
    const sig = crypto_1.default.createHmac("sha256", secret).update(payload).digest("base64url");
    return `${payload}.${sig}`;
}
function verifyDaemonAttestation(username, nonce, hostFingerprint, daemonPublicKey, attestation) {
    const verifier = crypto_1.default.createVerify("SHA256");
    const message = `${username}:${nonce}:${hostFingerprint}`;
    verifier.update(message);
    verifier.end();
    try {
        const sig = Buffer.from(String(attestation || "").trim(), "base64");
        return verifier.verify(String(daemonPublicKey || "").trim(), sig);
    }
    catch {
        return false;
    }
}
function makeCloudSession(body) {
    const iat = Date.now();
    const exp = computeSessionExpiry(iat, body.ttlSeconds);
    return {
        username: normalizeUsername(body.username),
        mode: "cloud",
        iat,
        exp,
        capabilities: Array.isArray(body.capabilities) && body.capabilities.length > 0
            ? body.capabilities
            : ["profile:read", "me:public"],
    };
}
function createSessionRouter() {
    const router = express_1.default.Router();
    // Ensure read-model projection can recover after daemon/server restarts.
    (0, memoryStore_1.rebuildAuthorizedHostsProjection)();
    router.post("/api/v1/session/nonce", (req, res) => {
        const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
        const body = (req.body || {});
        const username = normalizeUsername(body.username);
        if (!username) {
            return res.status(400).json((0, envelope_1.createErrorEnvelope)(target, { error: "USERNAME_REQUIRED" }));
        }
        const response = (0, memoryStore_1.createSessionNonce)(username, 2 * 60 * 1000);
        return res.json((0, envelope_1.createEnvelope)(target, { ...response }));
    });
    router.post("/api/v1/session/cloud", (req, res) => {
        const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
        const body = (req.body || {});
        const username = normalizeUsername(body.username);
        if (!username) {
            return res.status(400).json((0, envelope_1.createErrorEnvelope)(target, { error: "USERNAME_REQUIRED" }));
        }
        const session = makeCloudSession({ ...body, username });
        const namespace = resolveUserNamespace(req, username);
        (0, memoryStore_1.appendSemanticMemory)({
            namespace,
            path: `session.mode`,
            operator: "=",
            data: "cloud",
            timestamp: session.iat,
        });
        (0, memoryStore_1.appendSemanticMemory)({
            namespace,
            path: `session.last_seen`,
            operator: "=",
            data: session.iat,
            timestamp: session.iat,
        });
        const token = signSessionToken(session);
        return res.json((0, envelope_1.createEnvelope)(target, { session, token }));
    });
    router.post("/api/v1/session/host-verify", (req, res) => {
        const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
        const body = (req.body || {});
        const username = normalizeUsername(body.username);
        const nonce = String(body.nonce || "").trim();
        const hostFingerprint = String(body.host?.fingerprint || "").trim();
        const daemonPublicKey = String(body.host?.daemonPublicKey || "").trim();
        const attestation = String(body.host?.attestation || "").trim();
        const localEndpoint = String(body.host?.local_endpoint || "").trim() || "localhost:8161";
        const hostLabel = deriveHostLabel({
            explicitLabel: String(body.host?.label || "").trim(),
            explicitHostname: String(body.host?.hostname || "").trim(),
            localEndpoint,
            fingerprint: hostFingerprint,
        });
        const hostname = String(body.host?.hostname || "").trim() || parseEndpointHost(localEndpoint);
        if (!username || !nonce || !hostFingerprint || !daemonPublicKey || !attestation) {
            return res.status(400).json((0, envelope_1.createErrorEnvelope)(target, { error: "INVALID_HOST_VERIFY_PAYLOAD" }));
        }
        if (!(0, memoryStore_1.consumeSessionNonce)(username, nonce)) {
            return res.status(403).json((0, envelope_1.createErrorEnvelope)(target, { error: "NONCE_INVALID_OR_EXPIRED" }));
        }
        const verified = verifyDaemonAttestation(username, nonce, hostFingerprint, daemonPublicKey, attestation);
        if (!verified) {
            return res.status(403).json((0, envelope_1.createErrorEnvelope)(target, { error: "ATTESTATION_INVALID" }));
        }
        const namespace = resolveUserNamespace(req, username);
        if ((0, memoryStore_1.getHostStatus)(namespace, username, hostFingerprint) === "revoked") {
            return res.status(403).json((0, envelope_1.createErrorEnvelope)(target, { error: "HOST_REVOKED" }));
        }
        const iat = Date.now();
        const exp = computeSessionExpiry(iat, body.ttlSeconds);
        const capabilities = Array.isArray(body.host?.capabilities) && body.host.capabilities.length > 0
            ? body.host.capabilities
            : ["profile:read", "me:public", "sync", "sign", "local_fs"];
        const session = {
            username,
            mode: "host",
            iat,
            exp,
            capabilities,
            host: {
                fingerprint: hostFingerprint,
                local_endpoint: localEndpoint,
                attestation,
            },
        };
        (0, memoryStore_1.appendSemanticMemory)({
            namespace,
            path: `host.${hostLabel}.fingerprint`,
            operator: "=",
            data: hostFingerprint,
            timestamp: iat,
        });
        (0, memoryStore_1.appendSemanticMemory)({
            namespace,
            path: `host.${hostLabel}.label`,
            operator: "=",
            data: hostLabel,
            timestamp: iat,
        });
        (0, memoryStore_1.appendSemanticMemory)({
            namespace,
            path: `host.${hostLabel}.hostname`,
            operator: "=",
            data: hostname,
            timestamp: iat,
        });
        (0, memoryStore_1.appendSemanticMemory)({
            namespace,
            path: `host.${hostLabel}.status`,
            operator: "=",
            data: "authorized",
            timestamp: iat,
        });
        (0, memoryStore_1.appendSemanticMemory)({
            namespace,
            path: `host.${hostLabel}.capabilities`,
            operator: "=",
            data: capabilities,
            timestamp: iat,
        });
        (0, memoryStore_1.appendSemanticMemory)({
            namespace,
            path: `host.${hostLabel}.last_seen`,
            operator: "=",
            data: iat,
            timestamp: iat,
        });
        (0, memoryStore_1.appendSemanticMemory)({
            namespace,
            path: `host.${hostLabel}.local_endpoint`,
            operator: "=",
            data: localEndpoint,
            timestamp: iat,
        });
        (0, memoryStore_1.appendSemanticMemory)({
            namespace,
            path: `host.${hostLabel}.public_key`,
            operator: "=",
            data: daemonPublicKey,
            timestamp: iat,
        });
        (0, memoryStore_1.appendSemanticMemory)({
            namespace,
            path: `host.${hostLabel}.attestation`,
            operator: "=",
            data: attestation,
            timestamp: iat,
            signature: attestation,
        });
        (0, memoryStore_1.appendSemanticMemory)({
            namespace,
            path: `session.mode`,
            operator: "=",
            data: "host",
            timestamp: iat,
        });
        (0, memoryStore_1.appendSemanticMemory)({
            namespace,
            path: `session.last_seen`,
            operator: "=",
            data: iat,
            timestamp: iat,
        });
        const token = signSessionToken(session);
        return res.json((0, envelope_1.createEnvelope)(target, { session, token }));
    });
    router.get("/api/v1/hosts/:username", (req, res) => {
        const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
        const username = normalizeUsername(String(req.params.username || ""));
        if (!username) {
            return res.status(400).json((0, envelope_1.createErrorEnvelope)(target, { error: "USERNAME_REQUIRED" }));
        }
        const namespace = resolveUserNamespace(req, username);
        const hosts = (0, memoryStore_1.listHostsByNamespace)(namespace, username).map((host) => ({
            id: host.id,
            namespace: host.namespace,
            host_key: host.host_key,
            username: host.username,
            fingerprint: host.fingerprint,
            public_key: host.public_key,
            hostname: host.hostname,
            label: host.label,
            local_endpoint: host.local_endpoint,
            capabilities: (() => {
                try {
                    const parsed = JSON.parse(host.capabilities_json || "[]");
                    return Array.isArray(parsed) ? parsed : [];
                }
                catch {
                    return [];
                }
            })(),
            status: host.status,
            created_at: host.created_at,
            last_used: host.last_used,
            revoked_at: host.revoked_at,
        }));
        return res.json((0, envelope_1.createEnvelope)(target, {
            username,
            hosts,
            count: hosts.length,
        }));
    });
    router.get("/api/v1/hosts/:username/:fingerprint/history", (req, res) => {
        const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
        const username = normalizeUsername(String(req.params.username || ""));
        const fingerprint = String(req.params.fingerprint || "").trim();
        const limit = Number(req.query?.limit || 200);
        if (!username || !fingerprint) {
            return res.status(400).json((0, envelope_1.createErrorEnvelope)(target, { error: "INVALID_HISTORY_PAYLOAD" }));
        }
        const namespace = resolveUserNamespace(req, username);
        const memories = (0, memoryStore_1.listHostMemoryHistory)(namespace, username, fingerprint, limit).map((m) => ({
            id: m.id,
            namespace: m.namespace,
            host_key: m.host_key,
            username: m.username,
            fingerprint: m.fingerprint,
            path: m.path,
            operator: m.operator,
            data: m.data,
            hash: m.hash,
            prevHash: m.prevHash,
            signature: m.signature,
            timestamp: m.timestamp,
        }));
        return res.json((0, envelope_1.createEnvelope)(target, {
            username,
            fingerprint,
            memories,
            count: memories.length,
        }));
    });
    router.post("/api/v1/hosts/revoke", (req, res) => {
        const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
        const body = (req.body || {});
        const username = normalizeUsername(body.username);
        const hostFingerprint = String(body.hostFingerprint || "").trim();
        if (!username || !hostFingerprint) {
            return res.status(400).json((0, envelope_1.createErrorEnvelope)(target, { error: "INVALID_REVOKE_PAYLOAD" }));
        }
        const now = Date.now();
        const namespace = resolveUserNamespace(req, username);
        const hosts = (0, memoryStore_1.listHostsByNamespace)(namespace, username);
        const host = hosts.find((entry) => entry.fingerprint === hostFingerprint);
        const hostKey = host?.host_key || normalizeHostKey(hostFingerprint);
        (0, memoryStore_1.appendSemanticMemory)({
            namespace,
            path: `host.${hostKey}.status`,
            operator: "=",
            data: "revoked",
            timestamp: now,
        });
        (0, memoryStore_1.appendSemanticMemory)({
            namespace,
            path: `host.${hostKey}.last_seen`,
            operator: "=",
            data: now,
            timestamp: now,
        });
        return res.json((0, envelope_1.createEnvelope)(target, {
            revoked: true,
            username,
            hostFingerprint,
            timestamp: now,
        }));
    });
    return router;
}
