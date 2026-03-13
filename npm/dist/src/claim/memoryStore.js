"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSessionNonce = createSessionNonce;
exports.consumeSessionNonce = consumeSessionNonce;
exports.appendSemanticMemory = appendSemanticMemory;
exports.rebuildAuthorizedHostsProjection = rebuildAuthorizedHostsProjection;
exports.listHostsByUsername = listHostsByUsername;
exports.getHostStatus = getHostStatus;
exports.listHostMemoryHistory = listHostMemoryHistory;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../Blockchain/db");
db_1.db.exec(`
CREATE TABLE IF NOT EXISTS semantic_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  namespace TEXT NOT NULL,
  path TEXT NOT NULL,
  operator TEXT,
  data TEXT NOT NULL,
  hash TEXT NOT NULL,
  prevHash TEXT NOT NULL,
  signature TEXT,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_semantic_memories_namespace_id
ON semantic_memories(namespace, id);

CREATE INDEX IF NOT EXISTS idx_semantic_memories_path_id
ON semantic_memories(path, id);

CREATE TABLE IF NOT EXISTS session_nonces (
  username TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  iat INTEGER NOT NULL,
  exp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_nonces_exp
ON session_nonces(exp);

CREATE TABLE IF NOT EXISTS authorized_hosts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  public_key TEXT NOT NULL,
  label TEXT NOT NULL,
  local_endpoint TEXT NOT NULL,
  attestation TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL,
  revoked_at INTEGER,
  UNIQUE(username, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_authorized_hosts_username
ON authorized_hosts(username);

CREATE INDEX IF NOT EXISTS idx_authorized_hosts_status
ON authorized_hosts(status);
`);
function normalizeUsername(input) {
    return String(input || "").trim().toLowerCase();
}
function parseJsonSafe(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return raw;
    }
}
function stableStringify(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((x) => stableStringify(x)).join(",")}]`;
    const obj = value;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
function computeHash(input) {
    const h = crypto_1.default.createHash("sha256");
    h.update(stableStringify({
        namespace: input.namespace,
        path: input.path,
        operator: input.operator,
        data: input.data,
        prevHash: input.prevHash,
        timestamp: input.timestamp,
    }));
    return h.digest("hex");
}
function parseHostPath(path) {
    const match = String(path || "").match(/^([a-z0-9._-]+)\.cleaker\.me\/hosts\/([^/]+)\/([a-z_]+)$/i);
    if (!match)
        return null;
    const username = normalizeUsername(match[1]);
    const fingerprint = String(match[2] || "").trim();
    const field = String(match[3] || "").trim();
    if (!username || !fingerprint)
        return null;
    if (!["status", "capabilities", "last_seen", "local_endpoint", "public_key", "label", "attestation"].includes(field))
        return null;
    return { username, fingerprint, field };
}
function ensureHostBase(username, fingerprint, timestamp) {
    const existing = db_1.db.prepare(`
    SELECT id FROM authorized_hosts WHERE username = ? AND fingerprint = ?
  `).get(username, fingerprint);
    if (existing)
        return;
    db_1.db.prepare(`
    INSERT INTO authorized_hosts (
      id, username, fingerprint, public_key, label, local_endpoint, attestation,
      capabilities_json, status, created_at, last_used, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(crypto_1.default.randomUUID(), username, fingerprint, "", "", "localhost:8161", "", "[]", "authorized", timestamp, timestamp, null);
}
function projectHostMemory(memory) {
    const parsed = parseHostPath(memory.path);
    if (!parsed)
        return;
    ensureHostBase(parsed.username, parsed.fingerprint, memory.timestamp);
    switch (parsed.field) {
        case "status": {
            const status = String(memory.data || "").toLowerCase() === "revoked" ? "revoked" : "authorized";
            db_1.db.prepare(`
        UPDATE authorized_hosts
        SET status = ?, last_used = ?, revoked_at = CASE WHEN ? = 'revoked' THEN ? ELSE NULL END
        WHERE username = ? AND fingerprint = ?
      `).run(status, memory.timestamp, status, memory.timestamp, parsed.username, parsed.fingerprint);
            break;
        }
        case "capabilities": {
            const capabilities = Array.isArray(memory.data) ? memory.data : [];
            db_1.db.prepare(`
        UPDATE authorized_hosts
        SET capabilities_json = ?, last_used = ?
        WHERE username = ? AND fingerprint = ?
      `).run(JSON.stringify(capabilities), memory.timestamp, parsed.username, parsed.fingerprint);
            break;
        }
        case "last_seen": {
            const lastSeen = Number(memory.data || memory.timestamp);
            db_1.db.prepare(`
        UPDATE authorized_hosts
        SET last_used = ?
        WHERE username = ? AND fingerprint = ?
      `).run(Number.isFinite(lastSeen) ? lastSeen : memory.timestamp, parsed.username, parsed.fingerprint);
            break;
        }
        case "local_endpoint": {
            db_1.db.prepare(`
        UPDATE authorized_hosts
        SET local_endpoint = ?, last_used = ?
        WHERE username = ? AND fingerprint = ?
      `).run(String(memory.data || "localhost:8161"), memory.timestamp, parsed.username, parsed.fingerprint);
            break;
        }
        case "public_key": {
            db_1.db.prepare(`
        UPDATE authorized_hosts
        SET public_key = ?, last_used = ?
        WHERE username = ? AND fingerprint = ?
      `).run(String(memory.data || ""), memory.timestamp, parsed.username, parsed.fingerprint);
            break;
        }
        case "label": {
            db_1.db.prepare(`
        UPDATE authorized_hosts
        SET label = ?, last_used = ?
        WHERE username = ? AND fingerprint = ?
      `).run(String(memory.data || ""), memory.timestamp, parsed.username, parsed.fingerprint);
            break;
        }
        case "attestation": {
            db_1.db.prepare(`
        UPDATE authorized_hosts
        SET attestation = ?, last_used = ?
        WHERE username = ? AND fingerprint = ?
      `).run(String(memory.data || ""), memory.timestamp, parsed.username, parsed.fingerprint);
            break;
        }
        default:
            break;
    }
}
function createSessionNonce(usernameInput, ttlMs = 120000) {
    const username = normalizeUsername(usernameInput);
    const iat = Date.now();
    const exp = iat + Math.max(1000, ttlMs);
    const nonce = crypto_1.default.randomBytes(24).toString("base64url");
    db_1.db.prepare(`
    INSERT INTO session_nonces (username, nonce, iat, exp)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      nonce = excluded.nonce,
      iat = excluded.iat,
      exp = excluded.exp
  `).run(username, nonce, iat, exp);
    return { username, nonce, iat, exp };
}
function consumeSessionNonce(usernameInput, nonceInput) {
    const username = normalizeUsername(usernameInput);
    const nonce = String(nonceInput || "").trim();
    if (!username || !nonce)
        return false;
    const row = db_1.db.prepare(`
    SELECT nonce, exp FROM session_nonces WHERE username = ?
  `).get(username);
    if (!row)
        return false;
    const valid = row.nonce === nonce && Number(row.exp) >= Date.now();
    if (valid) {
        db_1.db.prepare(`DELETE FROM session_nonces WHERE username = ?`).run(username);
    }
    return valid;
}
function appendSemanticMemory(input) {
    const namespace = String(input.namespace || "").trim().toLowerCase();
    const path = String(input.path || "").trim();
    const operator = input.operator ?? "=";
    const signature = input.signature ?? null;
    const timestamp = Number(input.timestamp || Date.now());
    if (!namespace || !path) {
        throw new Error("INVALID_MEMORY_INPUT");
    }
    const tx = db_1.db.transaction(() => {
        const last = db_1.db.prepare(`
      SELECT hash FROM semantic_memories WHERE namespace = ? ORDER BY id DESC LIMIT 1
    `).get(namespace);
        const prevHash = last?.hash || "";
        if (input.expectedPrevHash !== undefined && input.expectedPrevHash !== prevHash) {
            throw new Error("MEMORY_FORK_DETECTED");
        }
        const hash = computeHash({ namespace, path, operator, data: input.data, prevHash, timestamp });
        const result = db_1.db.prepare(`
      INSERT INTO semantic_memories (namespace, path, operator, data, hash, prevHash, signature, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(namespace, path, operator, JSON.stringify(input.data ?? null), hash, prevHash, signature, timestamp);
        const row = db_1.db.prepare(`
      SELECT id, namespace, path, operator, data, hash, prevHash, signature, timestamp
      FROM semantic_memories WHERE id = ?
    `).get(result.lastInsertRowid);
        const memory = {
            id: row.id,
            namespace: row.namespace,
            path: row.path,
            operator: row.operator,
            data: parseJsonSafe(row.data),
            hash: row.hash,
            prevHash: row.prevHash,
            signature: row.signature,
            timestamp: row.timestamp,
        };
        projectHostMemory(memory);
        return memory;
    });
    return tx();
}
function rebuildAuthorizedHostsProjection(usernameInput) {
    const username = usernameInput ? normalizeUsername(usernameInput) : "";
    if (username) {
        db_1.db.prepare(`DELETE FROM authorized_hosts WHERE username = ?`).run(username);
    }
    else {
        db_1.db.prepare(`DELETE FROM authorized_hosts`).run();
    }
    const rows = db_1.db.prepare(`
    SELECT id, namespace, path, operator, data, hash, prevHash, signature, timestamp
    FROM semantic_memories
    WHERE path LIKE ?
    ORDER BY id ASC
  `).all(username ? `${username}.cleaker.me/hosts/%` : `%.cleaker.me/hosts/%`);
    for (const row of rows) {
        projectHostMemory({
            id: row.id,
            namespace: row.namespace,
            path: row.path,
            operator: row.operator,
            data: parseJsonSafe(row.data),
            hash: row.hash,
            prevHash: row.prevHash,
            signature: row.signature,
            timestamp: row.timestamp,
        });
    }
    return rows.length;
}
function listHostsByUsername(usernameInput) {
    const username = normalizeUsername(usernameInput);
    if (!username)
        return [];
    return db_1.db.prepare(`
    SELECT
      id,
      username,
      fingerprint,
      public_key,
      label,
      local_endpoint,
      attestation,
      capabilities_json,
      status,
      created_at,
      last_used,
      revoked_at
    FROM authorized_hosts
    WHERE username = ?
    ORDER BY last_used DESC
  `).all(username);
}
function getHostStatus(usernameInput, fingerprintInput) {
    const username = normalizeUsername(usernameInput);
    const fingerprint = String(fingerprintInput || "").trim();
    if (!username || !fingerprint)
        return null;
    const row = db_1.db.prepare(`
    SELECT status FROM authorized_hosts WHERE username = ? AND fingerprint = ?
  `).get(username, fingerprint);
    return row?.status || null;
}
function listHostMemoryHistory(usernameInput, fingerprintInput, limitInput = 200) {
    const username = normalizeUsername(usernameInput);
    const fingerprint = String(fingerprintInput || "").trim();
    if (!username || !fingerprint)
        return [];
    const namespace = `${username}.cleaker.me`;
    const limit = Math.max(1, Math.min(2000, Number(limitInput || 200)));
    const prefix = `${namespace}/hosts/${fingerprint}/`;
    const rows = db_1.db.prepare(`
    SELECT id, namespace, path, operator, data, hash, prevHash, signature, timestamp
    FROM semantic_memories
    WHERE namespace = ? AND path LIKE ?
    ORDER BY id DESC
    LIMIT ?
  `).all(namespace, `${prefix}%`, limit);
    return rows.map((row) => ({
        id: row.id,
        namespace: row.namespace,
        path: row.path,
        operator: row.operator,
        data: parseJsonSafe(row.data),
        hash: row.hash,
        prevHash: row.prevHash,
        signature: row.signature,
        timestamp: row.timestamp,
        username,
        fingerprint,
    }));
}
