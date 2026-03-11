"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClaimsRouter = createClaimsRouter;
const express_1 = __importDefault(require("express"));
const records_1 = require("../claim/records");
const replay_1 = require("../claim/replay");
const meTarget_1 = require("./meTarget");
const envelope_1 = require("./envelope");
function createClaimsRouter() {
    const router = express_1.default.Router();
    router.post("/claims", (req, res) => {
        const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
        const body = req.body ?? {};
        const out = (0, records_1.claimNamespace)({
            namespace: String(body.namespace || ""),
            secret: String(body.secret || ""),
            publicKey: String(body.publicKey || "").trim() || null,
        });
        if (!out.ok) {
            const status = out.error === "NAMESPACE_TAKEN"
                ? 409
                : out.error === "NAMESPACE_REQUIRED" || out.error === "SECRET_REQUIRED"
                    ? 400
                    : 500;
            return res.status(status).json((0, envelope_1.createErrorEnvelope)(target, { error: out.error }));
        }
        return res.status(201).json((0, envelope_1.createEnvelope)(target, {
            namespace: out.record.namespace,
            identityHash: out.record.identityHash,
            createdAt: out.record.createdAt,
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
        return res.json((0, envelope_1.createEnvelope)(target, {
            namespace: out.record.namespace,
            identityHash: out.record.identityHash,
            noise: out.noise,
            memories,
            openedAt: Date.now(),
        }));
    });
    return router;
}
