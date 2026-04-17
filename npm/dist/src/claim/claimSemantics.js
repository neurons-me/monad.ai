"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedClaimNamespaceSemantics = seedClaimNamespaceSemantics;
const memoryStore_1 = require("./memoryStore");
const semanticCatalog_1 = require("./semanticCatalog");
function seedClaimNamespaceSemantics(input) {
    const timestamp = Number(input.timestamp || Date.now());
    const namespace = String(input.namespace || "").trim().toLowerCase();
    const seeds = [
        { path: "profile.username", data: String(input.username || "").trim().toLowerCase() },
        { path: "profile.name", data: String(input.name || "").trim() },
        { path: "profile.email", data: String(input.email || "").trim().toLowerCase() },
        { path: "profile.phone", data: String(input.phone || "").trim() },
        { path: "auth.claimed_at", data: timestamp },
        ...(0, semanticCatalog_1.buildClaimSemanticSeeds)({
            namespace,
            username: input.username,
            passwordHash: input.passwordHash,
        }),
    ];
    for (const seed of seeds) {
        (0, memoryStore_1.appendSemanticMemory)({
            namespace,
            path: seed.path,
            operator: seed.operator || "=",
            data: seed.data,
            timestamp,
        });
    }
    return timestamp;
}
