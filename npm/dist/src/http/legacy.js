"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLegacyRouter = createLegacyRouter;
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const users_1 = require("../Blockchain/users");
const faces_1 = require("../Blockchain/faces");
const faceMatch_1 = require("../Blockchain/faceMatch");
function createLegacyRouter() {
    const router = express_1.default.Router();
    // Fetch a single claimed username.
    router.get("/users/:username", (req, res) => {
        const username = String(req.params.username || "").trim().toLowerCase();
        if (!username)
            return res.status(400).json({ ok: false, error: "USERNAME_REQUIRED" });
        const user = (0, users_1.getUser)(username);
        if (!user)
            return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });
        return res.json({ ok: true, user });
    });
    // Claim a username on this host's ledger.
    router.post("/users", (req, res) => {
        const body = req.body ?? {};
        const username = String(body.username || "").trim().toLowerCase();
        const identityHash = String(body.identityHash || "").trim();
        const publicKey = String(body.publicKey || "").trim();
        if (!username)
            return res.status(400).json({ ok: false, error: "USERNAME_REQUIRED" });
        if (!identityHash)
            return res.status(400).json({ ok: false, error: "IDENTITY_HASH_REQUIRED" });
        if (!publicKey)
            return res.status(400).json({ ok: false, error: "PUBLIC_KEY_REQUIRED" });
        const out = (0, users_1.claimUser)(username, identityHash, publicKey);
        if (!out.ok)
            return res.status(409).json(out);
        return res.json({ ok: true, username });
    });
    // Store a face template payload for a username on this ledger.
    router.post("/faces/enroll", (req, res) => {
        const body = req.body ?? {};
        const username = String(body.username || "").trim().toLowerCase();
        const template = body.template;
        if (!username)
            return res.status(400).json({ ok: false, error: "USERNAME_REQUIRED" });
        if (!template || (typeof template !== "object" && !Array.isArray(template))) {
            return res.status(400).json({ ok: false, error: "TEMPLATE_REQUIRED" });
        }
        try {
            const user = (0, users_1.getUser)(username);
            if (!user) {
                return res.status(200).json({
                    ok: true,
                    enrolled: false,
                    status: "USER_NOT_FOUND",
                });
            }
            const tplVector = Array.isArray(template)
                ? template
                : Array.isArray(template?.template)
                    ? template.template
                    : null;
            if (!tplVector ||
                tplVector.length < 8 ||
                !tplVector.every((n) => typeof n === "number" && Number.isFinite(n))) {
                return res.status(400).json({ ok: false, status: "INVALID_TEMPLATE_VECTOR" });
            }
            const algo = String(template?.algo || "mediapipe.face_landmarker").trim();
            const version = String(template?.version || "").trim();
            const dims = Number(template?.dims || tplVector.length) || tplVector.length;
            const storedPayload = {
                algo,
                version,
                dims,
                template: tplVector,
            };
            const templateHash = crypto_1.default
                .createHash("sha256")
                .update(JSON.stringify(storedPayload))
                .digest("hex");
            const faceId = String(template?.faceId || "").trim() ||
                crypto_1.default
                    .createHash("sha256")
                    .update(String(user.identityHash || "") + "::" + templateHash)
                    .digest("hex")
                    .slice(0, 16);
            (0, faces_1.upsertFaceTemplate)({
                identityHash: String(user.identityHash || "").trim(),
                template: JSON.stringify(storedPayload),
                algo,
                dims,
                templateHash,
                faceId,
            });
            return res.json({ ok: true, status: "OK", enrolled: true, username });
        }
        catch (e) {
            return res.status(500).json({ ok: false, error: e?.message || "FACE_ENROLL_FAILED" });
        }
    });
    // Match a probe template against the stored face for the target user.
    router.post("/faces/match", (req, res) => {
        const body = req.body ?? {};
        const username = String(body.username || "").trim().toLowerCase();
        const template = body.template;
        const threshold = Number(body.threshold ?? 0.92);
        if (!username)
            return res.status(400).json({ ok: false, error: "USERNAME_REQUIRED" });
        const probeVector = Array.isArray(template)
            ? template
            : Array.isArray(template?.template)
                ? template.template
                : null;
        if (!probeVector ||
            probeVector.length < 8 ||
            !probeVector.every((n) => typeof n === "number" && Number.isFinite(n))) {
            return res.status(400).json({ ok: false, status: "INVALID_TEMPLATE_VECTOR" });
        }
        const user = (0, users_1.getUser)(username);
        if (!user) {
            return res.status(200).json({
                ok: true,
                match: false,
                status: "USER_NOT_FOUND",
            });
        }
        const storedRow = (0, faces_1.getFaceTemplate)(String(user.identityHash || "").trim());
        if (!storedRow) {
            return res.status(200).json({
                ok: true,
                match: false,
                status: "FACE_NOT_ENROLLED",
            });
        }
        let storedPayload = null;
        try {
            storedPayload =
                typeof storedRow?.template === "string"
                    ? JSON.parse(storedRow.template)
                    : storedRow?.template;
        }
        catch {
            storedPayload = null;
        }
        const storedVector = Array.isArray(storedPayload?.template) ? storedPayload.template : null;
        if (!storedVector || storedVector.length < 8) {
            return res.status(500).json({ ok: false, status: "STORED_TEMPLATE_CORRUPT" });
        }
        const storedFaces = [
            {
                id: String(storedRow?.faceId || "enrolled"),
                identityHash: String(storedRow?.identityHash || String(user.identityHash || "")),
                template: storedVector,
                version: storedPayload?.version || undefined,
            },
        ];
        const out = (0, faceMatch_1.matchFaceTemplate)(probeVector, storedFaces, {
            threshold,
            version: String(body.version || "").trim() || undefined,
        });
        return res.json({
            ok: true,
            status: "OK",
            match: out.match,
            best: out.best,
            score: out.best?.score ?? 0,
            threshold: out.threshold,
            candidates: out.candidates,
            dims: storedFaces[0].template.length,
            algo: storedPayload?.algo || storedRow?.algo || null,
            version: storedPayload?.version || null,
        });
    });
    return router;
}
