"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllUsers = getAllUsers;
exports.getUsersForRootNamespace = getUsersForRootNamespace;
exports.getUser = getUser;
exports.claimUser = claimUser;
exports.countBlocksForUser = countBlocksForUser;
// www/api/src/Blockchain/users.ts
// -------------------------------------------------------------
// Users Table Accessors (using shared SQLite db)
// -------------------------------------------------------------
const db_1 = require("./db");
const identity_1 = require("../namespace/identity");
function normalizeUsername(raw) {
    const u = String(raw || "").trim().toLowerCase();
    return u;
}
// -------------------------------------------------------------
// GET ALL USERS
// -------------------------------------------------------------
function getAllUsers() {
    return db_1.db
        .prepare(`
      SELECT username, identityHash, publicKey, createdAt, updatedAt
      FROM users
      ORDER BY createdAt ASC
    `)
        .all();
}
function getUsersForRootNamespace(rootNamespaceInput) {
    const rootNamespace = (0, identity_1.normalizeNamespaceRootName)(rootNamespaceInput);
    if (!rootNamespace)
        return [];
    const pointerRows = db_1.db
        .prepare(`
      SELECT namespace, path, data, timestamp
      FROM semantic_memories
      WHERE path LIKE 'users.%'
      ORDER BY id ASC
    `)
        .all();
    const seen = new Set();
    const users = [];
    for (const row of pointerRows) {
        const hostRoot = (0, identity_1.normalizeNamespaceRootName)(row.namespace);
        if (!hostRoot || hostRoot !== rootNamespace)
            continue;
        const match = String(row.path || "").trim().match(/^users\.([a-z0-9_-]+)$/i);
        const username = String(match?.[1] || "").trim().toLowerCase();
        if (seen.has(username))
            continue;
        seen.add(username);
        let projectedNamespace = "";
        try {
            const parsed = JSON.parse(String(row.data || "{}"));
            projectedNamespace = String(parsed?.__ptr || "").trim().toLowerCase();
        }
        catch {
            projectedNamespace = "";
        }
        const claim = projectedNamespace
            ? db_1.db
                .prepare(`
            SELECT namespace, identityHash, publicKey, createdAt, updatedAt
            FROM claims
            WHERE namespace = ?
          `)
                .get(projectedNamespace)
            : undefined;
        users.push({
            username,
            identityHash: String(claim?.identityHash || "").trim(),
            publicKey: String(claim?.publicKey || "").trim(),
            createdAt: Number(claim?.createdAt || row.timestamp || 0),
            updatedAt: Number(claim?.updatedAt || row.timestamp || 0),
        });
    }
    return users;
}
// -------------------------------------------------------------
// GET SINGLE USER
// -------------------------------------------------------------
function getUser(username) {
    const u = normalizeUsername(username);
    if (!u)
        return undefined;
    return db_1.db
        .prepare(`
      SELECT username, identityHash, publicKey, createdAt, updatedAt
      FROM users
      WHERE username = ?
    `)
        .get(u);
}
// -------------------------------------------------------------
// CLAIM USERNAME (insert new row)
// -------------------------------------------------------------
function claimUser(username, identityHash, publicKey) {
    const u = normalizeUsername(username);
    const ih = String(identityHash || "").trim();
    const pk = String(publicKey || "").trim();
    if (!u)
        return { ok: false, error: "USERNAME_REQUIRED" };
    if (!ih)
        return { ok: false, error: "IDENTITY_HASH_REQUIRED" };
    if (!pk)
        return { ok: false, error: "PUBLIC_KEY_REQUIRED" };
    const exists = db_1.db.prepare(`SELECT username FROM users WHERE username = ?`).get(u);
    if (exists) {
        return { ok: false, error: "USERNAME_TAKEN" };
    }
    const now = Date.now();
    db_1.db.prepare(`
    INSERT INTO users (username, identityHash, publicKey, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(u, ih, pk, now, now);
    const user = getUser(u);
    // Should always exist after insert; but keep it safe.
    return {
        ok: true,
        user: (user || { username: u, identityHash: ih, publicKey: pk, createdAt: now, updatedAt: now }),
    };
}
// -------------------------------------------------------------
// COUNT BLOCKS OWNED BY USER
// -------------------------------------------------------------
function countBlocksForUser(identityHash) {
    const ih = String(identityHash || "").trim();
    if (!ih)
        return 0;
    const row = db_1.db
        .prepare(`
      SELECT COUNT(*) AS count
      FROM blocks
      WHERE identityHash = ?
    `)
        .get(ih);
    return row?.count ?? 0;
}
