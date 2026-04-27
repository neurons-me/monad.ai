"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLegacyRouter = createLegacyRouter;
const express_1 = __importDefault(require("express"));
const users_1 = require("../Blockchain/users");
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
    return router;
}
