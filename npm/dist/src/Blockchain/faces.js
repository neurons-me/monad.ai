"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllFaces = getAllFaces;
exports.getFace = getFace;
exports.getFacesForIdentity = getFacesForIdentity;
exports.findIdentityByTemplateHash = findIdentityByTemplateHash;
exports.claimFace = claimFace;
exports.deleteFace = deleteFace;
exports.upsertFaceTemplate = upsertFaceTemplate;
exports.getFaceTemplate = getFaceTemplate;
// www/api/src/Blockchain/faces.ts
// -------------------------------------------------------------
// Faces Table Accessors (using shared SQLite db)
// -------------------------------------------------------------
// NOTE:
//  - This file only provides DB accessors.
//  - Do NOT store raw images. Store a compact face template/embedding and a hash.
//  - Keep the template format/version explicit so you can migrate later.
const db_1 = require("./db");
// -------------------------------------------------------------
// GET ALL FACES
// -------------------------------------------------------------
function getAllFaces() {
    return db_1.db
        .prepare(`
      SELECT faceId, identityHash, templateHash, template, algo, dims, createdAt, updatedAt
      FROM faces
      ORDER BY createdAt ASC
    `)
        .all();
}
// -------------------------------------------------------------
// GET SINGLE FACE BY faceId
// -------------------------------------------------------------
function getFace(faceId) {
    return db_1.db
        .prepare(`
      SELECT faceId, identityHash, templateHash, template, algo, dims, createdAt, updatedAt
      FROM faces
      WHERE faceId = ?
    `)
        .get(String(faceId || "").trim());
}
// -------------------------------------------------------------
// GET FACES FOR IDENTITY
// -------------------------------------------------------------
function getFacesForIdentity(identityHash) {
    return db_1.db
        .prepare(`
      SELECT faceId, identityHash, templateHash, template, algo, dims, createdAt, updatedAt
      FROM faces
      WHERE identityHash = ?
      ORDER BY createdAt ASC
    `)
        .all(String(identityHash || "").trim());
}
// -------------------------------------------------------------
// FIND IDENTITY BY TEMPLATE HASH
// -------------------------------------------------------------
function findIdentityByTemplateHash(templateHash) {
    const row = db_1.db
        .prepare(`
      SELECT identityHash
      FROM faces
      WHERE templateHash = ?
      LIMIT 1
    `)
        .get(String(templateHash || "").trim());
    return row?.identityHash ?? null;
}
// -------------------------------------------------------------
// CLAIM / REGISTER FACE TEMPLATE
// Enforces: 1 templateHash -> 1 identityHash (no duplicates across identities)
// Also supports: updating/replacing template for the SAME identityHash if faceId exists.
// -------------------------------------------------------------
function claimFace(args) {
    const faceId = String(args.faceId || "").trim();
    const identityHash = String(args.identityHash || "").trim();
    const templateHash = String(args.templateHash || "").trim();
    const template = String(args.template || "");
    const algo = String(args.algo || "").trim();
    const dims = Number(args.dims || 0);
    if (!faceId)
        return { ok: false, error: "FACE_ID_REQUIRED" };
    if (!identityHash)
        return { ok: false, error: "IDENTITY_HASH_REQUIRED" };
    if (!templateHash)
        return { ok: false, error: "TEMPLATE_HASH_REQUIRED" };
    if (!template)
        return { ok: false, error: "TEMPLATE_REQUIRED" };
    if (!algo)
        return { ok: false, error: "ALGO_REQUIRED" };
    if (!Number.isFinite(dims) || dims <= 0)
        return { ok: false, error: "DIMS_REQUIRED" };
    // If this templateHash is already registered to some identity, only allow if it matches.
    const existing = db_1.db
        .prepare(`SELECT faceId, identityHash FROM faces WHERE templateHash = ? LIMIT 1`)
        .get(templateHash);
    if (existing && existing.identityHash !== identityHash) {
        return { ok: false, error: "FACE_ALREADY_CLAIMED" };
    }
    const now = Date.now();
    // Upsert by faceId for the same identity.
    const byFaceId = db_1.db
        .prepare(`SELECT faceId, identityHash FROM faces WHERE faceId = ? LIMIT 1`)
        .get(faceId);
    if (byFaceId) {
        if (byFaceId.identityHash !== identityHash) {
            return { ok: false, error: "FACE_ID_OWNED_BY_OTHER_IDENTITY" };
        }
        db_1.db.prepare(`
      UPDATE faces
      SET templateHash = ?, template = ?, algo = ?, dims = ?, updatedAt = ?
      WHERE faceId = ?
    `).run(templateHash, template, algo, dims, now, faceId);
        return { ok: true, mode: "updated", faceId };
    }
    db_1.db.prepare(`
    INSERT INTO faces (faceId, identityHash, templateHash, template, algo, dims, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(faceId, identityHash, templateHash, template, algo, dims, now, now);
    return { ok: true, mode: "created", faceId };
}
// -------------------------------------------------------------
// DELETE FACE TEMPLATE (optional admin/local action)
// -------------------------------------------------------------
function deleteFace(faceId) {
    const id = String(faceId || "").trim();
    if (!id)
        return { ok: false, error: "FACE_ID_REQUIRED" };
    const exists = db_1.db
        .prepare(`SELECT faceId FROM faces WHERE faceId = ? LIMIT 1`)
        .get(id);
    if (!exists)
        return { ok: false, error: "FACE_NOT_FOUND" };
    db_1.db.prepare(`DELETE FROM faces WHERE faceId = ?`).run(id);
    return { ok: true };
}
// -------------------------------------------------------------
// Compatibility exports (older server code)
// -------------------------------------------------------------
function upsertFaceTemplate(args) {
    return claimFace(args);
}
function getFaceTemplate(identityHash) {
    const rows = getFacesForIdentity(String(identityHash || '').trim());
    return rows?.[0] ?? null;
}
