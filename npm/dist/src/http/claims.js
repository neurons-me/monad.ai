"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClaimsRouter = createClaimsRouter;
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const records_1 = require("../claim/records");
const replay_1 = require("../claim/replay");
const meTarget_1 = require("./meTarget");
const envelope_1 = require("./envelope");
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
function computeProofId(input) {
    return crypto_1.default
        .createHash("sha256")
        .update(toStableJson(input))
        .digest("hex");
}
function parseNamespaceIdentity(namespace) {
    const ns = String(namespace || "").trim().toLowerCase();
    if (!ns) {
        return {
            host: "unknown",
            username: "",
            effective: "unclaimed",
        };
    }
    const userMatch = ns.match(/^([^\/]+)\/users\/([^\/]+)$/i);
    if (userMatch) {
        const host = String(userMatch[1] || "").trim();
        const username = String(userMatch[2] || "").trim();
        return {
            host,
            username,
            effective: `@${username}.${host}`,
        };
    }
    const dotParts = ns.split(".").filter(Boolean);
    if (dotParts.length >= 3) {
        const username = dotParts[0] || "";
        const host = dotParts.slice(1).join(".");
        if (username && host) {
            return {
                host,
                username,
                effective: `@${username}.${host}`,
            };
        }
    }
    return {
        host: ns,
        username: "",
        effective: `@${ns}`,
    };
}
function getDefaultReadPolicy(namespace) {
    const identity = parseNamespaceIdentity(namespace);
    const allowed = ["profile/*", "me/public/*", `${namespace}/*`];
    if (identity.host) {
        allowed.push(`${identity.host}/*`);
    }
    return {
        allowed,
        capabilities: ["read"],
    };
}
function createClaimsRouter() {
    const router = express_1.default.Router();
    router.post("/claims", (req, res) => {
        const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
        const body = req.body ?? {};
        const out = (0, records_1.claimNamespace)({
            namespace: String(body.namespace || ""),
            secret: String(body.secret || ""),
            publicKey: String(body.publicKey || "").trim() || null,
            privateKey: String(body.privateKey || "").trim() || null,
        });
        if (!out.ok) {
            const status = out.error === "NAMESPACE_TAKEN"
                ? 409
                : out.error === "NAMESPACE_REQUIRED"
                    || out.error === "SECRET_REQUIRED"
                    || out.error === "CLAIM_KEY_INVALID"
                    || out.error === "CLAIM_KEYPAIR_MISMATCH"
                    ? 400
                    : 500;
            return res.status(status).json((0, envelope_1.createErrorEnvelope)(target, { error: out.error }));
        }
        return res.status(201).json((0, envelope_1.createEnvelope)(target, {
            namespace: out.record.namespace,
            identityHash: out.record.identityHash,
            publicKey: out.record.publicKey,
            createdAt: out.record.createdAt,
            persistentClaim: out.persistentClaim,
        }));
    });
    router.post("/claims/open", (req, res) => {
        const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
        const body = req.body ?? {};
        const out = (0, records_1.openNamespace)({
            namespace: String(body.namespace || ""),
            secret: String(body.secret || ""),
        });
        if (!out.ok) {
            const status = out.error === "CLAIM_NOT_FOUND"
                ? 404
                : out.error === "CLAIM_VERIFICATION_FAILED"
                    ? 403
                    : out.error === "NAMESPACE_REQUIRED" || out.error === "SECRET_REQUIRED"
                        ? 400
                        : 500;
            return res.status(status).json((0, envelope_1.createErrorEnvelope)(target, { error: out.error }));
        }
        const memories = (0, replay_1.getMemoriesForNamespace)(out.record.namespace);
        const openedAt = Date.now();
        const policy = getDefaultReadPolicy(out.record.namespace);
        const identity = parseNamespaceIdentity(out.record.namespace);
        const audit = {
            proofId: computeProofId({
                namespace: out.record.namespace,
                identityHash: out.record.identityHash,
                noise: out.noise,
                memories,
            }),
            openedAt,
        };
        return res.json((0, envelope_1.createEnvelope)(target, {
            verified: true,
            reasonCode: null,
            reason: null,
            identity,
            policy,
            audit,
            namespace: out.record.namespace,
            identityHash: out.record.identityHash,
            noise: out.noise,
            memories,
            openedAt,
        }));
    });
    return router;
}
