"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DB_PATH = exports.db = void 0;
// www/api/src/Blockchain/db.ts
// -------------------------------------------------------------
// SQLite connection — one semantic ledger per host
// -------------------------------------------------------------
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// -------------------------------------------------------------
// PATH DEL BLOCKCHAIN (1 por host)
// -------------------------------------------------------------
const BLOCKCHAIN_FILENAME = "blockchain.db";
// Usar CWD por ahora (configurable después)
const DB_PATH = path_1.default.join(process.cwd(), BLOCKCHAIN_FILENAME);
exports.DB_PATH = DB_PATH;
// -------------------------------------------------------------
// ASEGURAR QUE EL ARCHIVO EXISTE
// -------------------------------------------------------------
if (!fs_1.default.existsSync(DB_PATH)) {
    fs_1.default.writeFileSync(DB_PATH, "");
}
// -------------------------------------------------------------
// ABRIR CONEXIÓN (SYNC — recomendado para blockchain)
// -------------------------------------------------------------
let db;
try {
    exports.db = db = new better_sqlite3_1.default(DB_PATH);
    // Basic pragmas for better dev experience.
    // WAL gives better concurrency; foreign_keys is good hygiene.
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    // -------------------------------------------------------------
    // SCHEMA INIT (idempotent)
    // -------------------------------------------------------------
    db.exec(`
    CREATE TABLE IF NOT EXISTS blocks (
      blockId TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      namespace TEXT NOT NULL,
      identityHash TEXT,
      expression TEXT,
      json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_blocks_timestamp ON blocks(timestamp);
    CREATE INDEX IF NOT EXISTS idx_blocks_identityHash ON blocks(identityHash);

    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      identityHash TEXT NOT NULL,
      publicKey TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_identityHash ON users(identityHash);

    CREATE TABLE IF NOT EXISTS faces (
      faceId TEXT PRIMARY KEY,
      identityHash TEXT NOT NULL,
      templateHash TEXT NOT NULL,
      template TEXT NOT NULL,
      algo TEXT NOT NULL,
      dims INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      UNIQUE(templateHash)
    );

    CREATE INDEX IF NOT EXISTS idx_faces_identityHash ON faces(identityHash);
    CREATE INDEX IF NOT EXISTS idx_faces_templateHash ON faces(templateHash);
  `);
}
catch (err) {
    console.error("❌ SQLite ledger initialization failed:", err.message);
    throw err;
}
