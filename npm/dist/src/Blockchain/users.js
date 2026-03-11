"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllUsers = getAllUsers;
exports.getUser = getUser;
exports.claimUser = claimUser;
exports.countBlocksForUser = countBlocksForUser;
// www/api/src/Blockchain/users.ts
// -------------------------------------------------------------
// Users Table Accessors (using shared SQLite db)
// -------------------------------------------------------------
const db_1 = require("./db");
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
