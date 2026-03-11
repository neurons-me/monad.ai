"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendBlock = appendBlock;
exports.getAllBlocks = getAllBlocks;
exports.getBlocksForIdentity = getBlocksForIdentity;
exports.getBlocksForNamespace = getBlocksForNamespace;
// www/api/src/Blockchain/blockchain.ts
// -----------------------------------------------------------------------------
// Ledger blocks table (uses the shared SQLite instance from db.ts)
// -----------------------------------------------------------------------------
const db_1 = require("./db");
// -----------------------------------------------------------------------------
// SCHEMA (only once per host)
// -----------------------------------------------------------------------------
// 1) Create tables (no indexes yet; migrations may add columns on existing DBs)
db_1.db.exec(`
CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blockId TEXT NOT NULL UNIQUE,
  timestamp INTEGER NOT NULL,
  namespace TEXT NOT NULL,
  identityHash TEXT NOT NULL,
  expression TEXT NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  identityHash TEXT NOT NULL,
  publicKey TEXT NOT NULL,
  commitment TEXT,
  identityNoise TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  namespace TEXT PRIMARY KEY,
  identityHash TEXT NOT NULL,
  encryptedNoise TEXT NOT NULL,
  publicKey TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
`);
// 2) Lightweight migrations (safe for existing DBs)
function addColumnIfMissing(table, col, type) {
    const info = db_1.db.prepare(`PRAGMA table_info(${table})`).all();
    const exists = info.some((r) => r.name === col);
    if (!exists) {
        db_1.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
        console.log(`🧬 Migration: added ${table}.${col}`);
    }
}
addColumnIfMissing("users", "commitment", "TEXT");
addColumnIfMissing("users", "identityNoise", "TEXT");
// Backfill NOT NULL expectations for newly added columns on old rows (if any)
db_1.db.exec(`
UPDATE users SET commitment = '' WHERE commitment IS NULL;
UPDATE users SET identityNoise = '' WHERE identityNoise IS NULL;
`);
// 3) Create indexes (after columns exist)
db_1.db.exec(`
CREATE INDEX IF NOT EXISTS idx_blocks_identity ON blocks(identityHash);
CREATE INDEX IF NOT EXISTS idx_blocks_namespace ON blocks(namespace);
CREATE INDEX IF NOT EXISTS idx_blocks_ts ON blocks(timestamp);
CREATE INDEX IF NOT EXISTS idx_users_identity ON users(identityHash);
CREATE INDEX IF NOT EXISTS idx_users_commitment ON users(commitment);
CREATE INDEX IF NOT EXISTS idx_claims_identity ON claims(identityHash);
`);
// -----------------------------------------------------------------------------
// Insert Block
// -----------------------------------------------------------------------------
const insertStmt = db_1.db.prepare(`
  INSERT INTO blocks (blockId, timestamp, namespace, identityHash, expression, json)
  VALUES (@blockId, @timestamp, @namespace, @identityHash, @expression, @json)
`);
function appendBlock(block) {
    const payload = block?.json ?? block;
    insertStmt.run({
        blockId: block.blockId,
        timestamp: block.timestamp,
        namespace: block.namespace,
        identityHash: block.identityHash,
        expression: block.expression,
        json: JSON.stringify(payload),
    });
    return { ok: true, blockId: block.blockId };
}
// -----------------------------------------------------------------------------
// Read Blocks
// -----------------------------------------------------------------------------
function getAllBlocks() {
    return db_1.db.prepare("SELECT * FROM blocks ORDER BY id ASC").all();
}
function getBlocksForIdentity(identityHash) {
    return db_1.db.prepare(`
    SELECT * FROM blocks WHERE identityHash = ? ORDER BY id ASC
  `).all(identityHash);
}
function getBlocksForNamespace(namespace) {
    return db_1.db.prepare(`
    SELECT * FROM blocks WHERE namespace = ? ORDER BY id ASC
  `).all(namespace);
}
