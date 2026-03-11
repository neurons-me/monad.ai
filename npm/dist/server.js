"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const db_1 = require("./src/Blockchain/db");
const blockchain_1 = require("./src/Blockchain/blockchain");
const users_1 = require("./src/Blockchain/users");
const records_1 = require("./src/claim/records");
const replay_1 = require("./src/claim/replay");
const namespace_1 = require("./src/http/namespace");
const meTarget_1 = require("./src/http/meTarget");
const envelope_1 = require("./src/http/envelope");
const pathResolver_1 = require("./src/http/pathResolver");
const claims_1 = require("./src/http/claims");
const legacy_1 = require("./src/http/legacy");
const shell_1 = require("./src/http/shell");
const PORT = process.env.PORT || 8161;
const app = (0, express_1.default)();
app.set("trust proxy", true);
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Serve built GUI assets from this.GUI package dist
app.use("/gui", express_1.default.static(shell_1.GUI_PKG_DIST_DIR));
// Bootstrap endpoint for GUI runtime (namespace + endpoint hints)
app.get("/__bootstrap", (req, res) => {
    const namespace = (0, namespace_1.resolveNamespace)(req);
    const host = (0, namespace_1.resolveHostNamespace)(req);
    const origin = `${req.protocol}://${host}`;
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    return res.json((0, envelope_1.createEnvelope)(target, { host, namespace, apiOrigin: origin }));
});
// HTML shell for root and any deep route when Accept: text/html
app.get("/", (req, res, next) => {
    if (!(0, shell_1.wantsHtml)(req))
        return next();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send((0, shell_1.htmlShell)());
});
// Minimal request logger (no identity semantics, only transport info)
app.use((req, _res, next) => {
    const ns = (0, namespace_1.resolveNamespace)(req);
    const host = (0, namespace_1.resolveHostNamespace)(req);
    const lens = (0, namespace_1.resolveLens)(req);
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    console.log(`→ ${req.method} ${req.url} host=${host || "unknown"} ns=${ns} lens=${lens} op=${target.operation} me=${target.meTarget}`);
    next();
});
// --- Universal Ledger Write Surface ---------------------------------
// Accept ANY ME block (or arbitrary JSON) and append me to the ledger.
app.post("/", async (req, res) => {
    const body = req.body;
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    if (!body || typeof body !== "object") {
        return res.status(400).json((0, envelope_1.createErrorEnvelope)(target, {
            error: "Expected JSON block in request body",
        }));
    }
    const blockId = crypto.randomUUID();
    const timestamp = Date.now();
    const namespace = (0, namespace_1.resolveNamespace)(req);
    const claim = (0, records_1.getClaim)(namespace);
    if (claim) {
        const authorized = (0, replay_1.isNamespaceWriteAuthorized)({
            claimIdentityHash: claim.identityHash,
            claimPublicKey: claim.publicKey,
            body,
        });
        if (!authorized) {
            return res.status(403).json((0, envelope_1.createErrorEnvelope)(target, {
                error: "NAMESPACE_WRITE_FORBIDDEN",
            }));
        }
    }
    const blockIdentityHash = claim
        ? claim.identityHash
        : String(body.identityHash || "").trim();
    const entry = await (0, blockchain_1.appendBlock)({
        blockId,
        timestamp,
        namespace,
        identityHash: blockIdentityHash,
        expression: body.expression || "",
        json: body,
    });
    (0, replay_1.recordMemory)({
        namespace,
        payload: body,
        identityHash: blockIdentityHash,
        timestamp,
    });
    console.log("🧱 New Ledger Block:");
    console.log(JSON.stringify(entry, null, 2));
    return res.json((0, envelope_1.createEnvelope)(target, {
        blockId,
        timestamp,
    }));
});
// --- Universal Ledger Read Surface ----------------------
app.get("/", async (req, res) => {
    const chainNs = (0, namespace_1.resolveNamespace)(req);
    const lens = (0, namespace_1.resolveLens)(req);
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    const limit = Math.max(1, Math.min(5000, Number(req.query?.limit ?? 5000)));
    const identityHash = String(req.query?.identityHash || "").trim();
    const all = await (0, blockchain_1.getAllBlocks)();
    const users = await (0, users_1.getAllUsers)();
    let blocks = (0, namespace_1.filterBlocksByNamespace)(all, chainNs);
    if (identityHash) {
        blocks = blocks.filter((b) => String(b?.identityHash || "") === identityHash);
    }
    // newest-first and limit
    blocks = blocks
        .slice()
        .sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0))
        .slice(0, limit);
    return res.json((0, envelope_1.createEnvelope)(target, {
        namespace: chainNs,
        lens,
        users,
        blocks,
        count: blocks.length,
    }));
});
// Explicit blocks endpoint (same semantics as GET /, but clearer name)
app.get("/blocks", async (req, res) => {
    // Delegate by rewriting url semantics in place
    // (Keep implementation simple by copying the same logic.)
    const ns = (0, namespace_1.resolveNamespace)(req);
    const lens = (0, namespace_1.resolveLens)(req);
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    const limit = Math.max(1, Math.min(5000, Number(req.query?.limit ?? 5000)));
    const identityHash = String(req.query?.identityHash || "").trim();
    const all = await (0, blockchain_1.getAllBlocks)();
    let blocks = (0, namespace_1.filterBlocksByNamespace)(all, ns);
    if (identityHash) {
        blocks = blocks.filter((b) => String(b?.identityHash || "") === identityHash);
    }
    blocks = blocks
        .slice()
        .sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0))
        .slice(0, limit);
    return res.json((0, envelope_1.createEnvelope)(target, {
        namespace: ns,
        lens,
        blocks,
        count: blocks.length,
    }));
});
// --- Convenience: allow GET /@... to behave like GET / but with path-based namespace addressing.
// NOTE: This MUST be defined before the catch-all path resolver.
app.get("/@*", async (req, res) => {
    const chainNs = (0, namespace_1.resolveNamespace)(req);
    const lens = (0, namespace_1.resolveLens)(req);
    const target = (0, meTarget_1.normalizeHttpRequestToMeTarget)(req);
    const limit = Math.max(1, Math.min(5000, Number(req.query?.limit ?? 5000)));
    const identityHash = String(req.query?.identityHash || "").trim();
    const all = await (0, blockchain_1.getAllBlocks)();
    let blocks = (0, namespace_1.filterBlocksByNamespace)(all, chainNs);
    if (identityHash) {
        blocks = blocks.filter((b) => String(b?.identityHash || "") === identityHash);
    }
    blocks = blocks
        .slice()
        .sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0))
        .slice(0, limit);
    return res.json((0, envelope_1.createEnvelope)(target, {
        namespace: chainNs,
        lens,
        blocks,
        count: blocks.length,
    }));
});
// Legacy extensions: username claims and biometric matching remain available,
// but they are no longer presented as core cleaker semantics.
app.use((0, claims_1.createClaimsRouter)());
app.use((0, legacy_1.createLegacyRouter)());
// --- Path Resolver Catch-all (MUST be last route before app.listen) ---
app.get("/*", (req, res, next) => {
    // If a browser is requesting HTML, always return the SPA shell.
    if ((0, shell_1.wantsHtml)(req)) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.status(200).send((0, shell_1.htmlShell)());
    }
    return (0, pathResolver_1.createPathResolverHandler)()(req, res);
});
// --- Start Server ----------------------------------------
app.listen(PORT, () => {
    console.log(`\n🚀 Monad.ai daemon running at: http://localhost:${PORT}`);
    console.log("\n∴ Material Surface");
    console.log(`  - Ledger DB:      ${db_1.DB_PATH}`);
    console.log("  - Give thought:   POST /        (append JSON into current namespace)");
    console.log("  - Reach thought:  GET  /        (read current namespace surface)");
    console.log("  - Read blocks:    GET  /blocks  (explicit block stream view)");
    console.log("\n🔐 Claim Surface");
    console.log("  - Claim space:    POST /claims       (forge claim record + encrypted noise)");
    console.log("  - Open space:     POST /claims/open  (verify trinity -> recover noise)");
    console.log("\n🌐 Routing / Namespaces");
    console.log("  - Host header determines the chain namespace");
    console.log("  - Examples:");
    console.log("    • cleaker.me                 -> cleaker.me");
    console.log("    • username.cleaker.me        -> cleaker.me/users/username");
    console.log("    • username.localhost         -> localhost/users/username");
    console.log("    • cleaker.me/@username        -> cleaker.me/users/username (path-based)");
    console.log("    • localhost/@username         -> localhost/users/username (path-based)");
    console.log("    • cleaker.me/@a+b             -> cleaker.me/relations/a+b (symmetric relation)");
    console.log("    • cleaker.me/@a/@b            -> cleaker.me/users/a/users/b (directional nesting)");
    console.log("\n🔎 Namespace Reads");
    console.log("  - Resolve path:   GET  /<any/path>   e.g. /profile/displayName");
    console.log("    (Resolves within the chain namespace derived from host)");
    console.log("\n🕰 Legacy Extensions");
    console.log("  - Claim username: POST /users");
    console.log("  - Lookup user:    GET  /users/:username");
    console.log("  - Enroll face:    POST /faces/enroll");
    console.log("  - Match face:     POST /faces/match\n");
});
