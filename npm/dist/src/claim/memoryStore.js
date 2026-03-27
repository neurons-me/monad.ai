"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSessionNonce = createSessionNonce;
exports.consumeSessionNonce = consumeSessionNonce;
exports.appendSemanticMemory = appendSemanticMemory;
exports.listSemanticMemoriesByNamespace = listSemanticMemoriesByNamespace;
exports.listSemanticMemoriesByRootNamespace = listSemanticMemoriesByRootNamespace;
exports.rebuildAuthorizedHostsProjection = rebuildAuthorizedHostsProjection;
exports.listHostsByUsername = listHostsByUsername;
exports.listHostsByNamespace = listHostsByNamespace;
exports.getHostStatus = getHostStatus;
exports.listHostMemoryHistory = listHostMemoryHistory;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../Blockchain/db");
const identity_1 = require("../namespace/identity");
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
  namespace TEXT NOT NULL,
  username TEXT NOT NULL,
  host_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  public_key TEXT NOT NULL,
  hostname TEXT NOT NULL,
  label TEXT NOT NULL,
  local_endpoint TEXT NOT NULL,
  attestation TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL,
  revoked_at INTEGER,
  UNIQUE(namespace, username, host_key)
);

CREATE INDEX IF NOT EXISTS idx_authorized_hosts_status
ON authorized_hosts(status);
`);
function hasAuthorizedHostColumn(name) {
    const rows = db_1.db.prepare(`PRAGMA table_info(authorized_hosts)`).all();
    return rows.some((row) => String(row.name || "").trim().toLowerCase() === String(name || "").trim().toLowerCase());
}
function migrateAuthorizedHostsSchema() {
    const hasNamespace = hasAuthorizedHostColumn("namespace");
    const hasHostKey = hasAuthorizedHostColumn("host_key");
    const hasHostname = hasAuthorizedHostColumn("hostname");
    if (hasNamespace && hasHostKey && hasHostname)
        return;
    db_1.db.exec(`
    CREATE TABLE IF NOT EXISTS authorized_hosts_v2 (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      username TEXT NOT NULL,
      host_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      public_key TEXT NOT NULL,
      hostname TEXT NOT NULL,
      label TEXT NOT NULL,
      local_endpoint TEXT NOT NULL,
      attestation TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used INTEGER NOT NULL,
      revoked_at INTEGER,
      UNIQUE(namespace, username, host_key)
    );
  `);
    db_1.db.exec(`
    INSERT OR IGNORE INTO authorized_hosts_v2 (
      id, namespace, username, host_key, fingerprint, public_key, hostname, label,
      local_endpoint, attestation, capabilities_json, status, created_at, last_used, revoked_at
    )
    SELECT
      id,
      CASE
        WHEN username IS NOT NULL AND TRIM(username) <> '' THEN LOWER(TRIM(username)) || '.cleaker.me'
        ELSE 'unknown'
      END AS namespace,
      username,
      CASE
        WHEN label IS NOT NULL AND TRIM(label) <> '' THEN LOWER(REPLACE(REPLACE(TRIM(label), '.local', ''), ' ', '-'))
        WHEN fingerprint IS NOT NULL AND TRIM(fingerprint) <> '' THEN LOWER(TRIM(fingerprint))
        ELSE 'host'
      END AS host_key,
      fingerprint,
      public_key,
      '' AS hostname,
      label,
      local_endpoint,
      attestation,
      capabilities_json,
      status,
      created_at,
      last_used,
      revoked_at
    FROM authorized_hosts;
  `);
    db_1.db.exec(`DROP TABLE authorized_hosts;`);
    db_1.db.exec(`ALTER TABLE authorized_hosts_v2 RENAME TO authorized_hosts;`);
    db_1.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_authorized_hosts_namespace_username
    ON authorized_hosts(namespace, username);
  `);
    db_1.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_authorized_hosts_status
    ON authorized_hosts(status);
  `);
}
migrateAuthorizedHostsSchema();
if (hasAuthorizedHostColumn("namespace")) {
    db_1.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_authorized_hosts_namespace_username
    ON authorized_hosts(namespace, username);
  `);
}
function normalizeUsername(input) {
    return String(input || "").trim().toLowerCase();
}
function normalizeHostKey(input) {
    return String(input || "")
        .trim()
        .toLowerCase()
        .replace(/\.local$/i, "")
        .replace(/[^a-z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
}
function parseEndpointHost(input) {
    const raw = String(input || "").trim();
    if (!raw)
        return "";
    try {
        return String(new URL(raw).hostname || "").trim().toLowerCase();
    }
    catch {
        return raw
            .replace(/^https?:\/\//i, "")
            .split("/")[0]
            .split(":")[0]
            .trim()
            .toLowerCase();
    }
}
function isLoopbackishHost(host) {
    const normalized = String(host || "").trim().toLowerCase();
    return /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)$/.test(normalized);
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
function parseHostPath(memory) {
    const namespace = String(memory.namespace || "").trim().toLowerCase();
    const path = String(memory.path || "").trim();
    const relative = path.match(/^host\.([a-z0-9_-]+)\.([a-z_]+)$/i);
    if (relative) {
        const username = normalizeUsername(String(namespace.split(".")[0] || ""));
        const hostKey = normalizeHostKey(String(relative[1] || ""));
        const field = String(relative[2] || "").trim();
        if (!username || !hostKey)
            return null;
        if (!["fingerprint", "status", "capabilities", "last_seen", "local_endpoint", "public_key", "label", "hostname", "attestation"].includes(field)) {
            return null;
        }
        return { namespace, username, hostKey, field };
    }
    const legacy = path.match(/^([a-z0-9._-]+)\.cleaker\.me\/hosts\/([^/]+)\/([a-z_]+)$/i);
    if (!legacy)
        return null;
    const username = normalizeUsername(String(legacy[1] || ""));
    const hostKey = normalizeHostKey(String(legacy[2] || ""));
    const field = String(legacy[3] || "").trim();
    if (!username || !hostKey)
        return null;
    if (!["status", "capabilities", "last_seen", "local_endpoint", "public_key", "label", "attestation"].includes(field))
        return null;
    return {
        namespace: namespace || `${username}.cleaker.me`,
        username,
        hostKey,
        field,
    };
}
function ensureHostBase(namespace, username, hostKey, timestamp) {
    const existing = db_1.db.prepare(`
    SELECT id FROM authorized_hosts WHERE namespace = ? AND username = ? AND host_key = ?
  `).get(namespace, username, hostKey);
    if (existing)
        return;
    db_1.db.prepare(`
    INSERT INTO authorized_hosts (
      id, namespace, username, host_key, fingerprint, public_key, hostname, label, local_endpoint, attestation,
      capabilities_json, status, created_at, last_used, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(crypto_1.default.randomUUID(), namespace, username, hostKey, "", "", "", hostKey, "localhost:8161", "", "[]", "authorized", timestamp, timestamp, null);
}
function projectHostMemory(memory) {
    const parsed = parseHostPath(memory);
    if (!parsed)
        return;
    ensureHostBase(parsed.namespace, parsed.username, parsed.hostKey, memory.timestamp);
    switch (parsed.field) {
        case "fingerprint": {
            db_1.db.prepare(`
        UPDATE authorized_hosts
        SET fingerprint = ?, last_used = ?
        WHERE namespace = ? AND username = ? AND host_key = ?
      `).run(String(memory.data || ""), memory.timestamp, parsed.namespace, parsed.username, parsed.hostKey);
            break;
        }
        case "status": {
            const status = String(memory.data || "").toLowerCase() === "revoked" ? "revoked" : "authorized";
            db_1.db.prepare(`
        UPDATE authorized_hosts
        SET status = ?, last_used = ?, revoked_at = CASE WHEN ? = 'revoked' THEN ? ELSE NULL END
        WHERE namespace = ? AND username = ? AND host_key = ?
      `).run(status, memory.timestamp, status, memory.timestamp, parsed.namespace, parsed.username, parsed.hostKey);
            break;
        }
        case "capabilities": {
            const capabilities = Array.isArray(memory.data) ? memory.data : [];
            db_1.db.prepare(`
        UPDATE authorized_hosts
        SET capabilities_json = ?, last_used = ?
        WHERE namespace = ? AND username = ? AND host_key = ?
      `).run(JSON.stringify(capabilities), memory.timestamp, parsed.namespace, parsed.username, parsed.hostKey);
            break;
        }
        case "last_seen": {
            const lastSeen = Number(memory.data || memory.timestamp);
            db_1.db.prepare(`
        UPDATE authorized_hosts
        SET last_used = ?
        WHERE namespace = ? AND username = ? AND host_key = ?
      `).run(Number.isFinite(lastSeen) ? lastSeen : memory.timestamp, parsed.namespace, parsed.username, parsed.hostKey);
            break;
        }
        case "local_endpoint": {
            db_1.db.prepare(`
        UPDATE authorized_hosts
        SET local_endpoint = ?, last_used = ?
        WHERE namespace = ? AND username = ? AND host_key = ?
      `).run(String(memory.data || "localhost:8161"), memory.timestamp, parsed.namespace, parsed.username, parsed.hostKey);
            break;
        }
        case "public_key": {
            db_1.db.prepare(`
        UPDATE authorized_hosts
        SET public_key = ?, last_used = ?
        WHERE namespace = ? AND username = ? AND host_key = ?
      `).run(String(memory.data || ""), memory.timestamp, parsed.namespace, parsed.username, parsed.hostKey);
            break;
        }
        case "label": {
            db_1.db.prepare(`
        UPDATE authorized_hosts
        SET label = ?, last_used = ?
        WHERE namespace = ? AND username = ? AND host_key = ?
      `).run(String(memory.data || ""), memory.timestamp, parsed.namespace, parsed.username, parsed.hostKey);
            break;
        }
        case "hostname": {
            db_1.db.prepare(`
        UPDATE authorized_hosts
        SET hostname = ?, last_used = ?
        WHERE namespace = ? AND username = ? AND host_key = ?
      `).run(String(memory.data || ""), memory.timestamp, parsed.namespace, parsed.username, parsed.hostKey);
            break;
        }
        case "attestation": {
            db_1.db.prepare(`
        UPDATE authorized_hosts
        SET attestation = ?, last_used = ?
        WHERE namespace = ? AND username = ? AND host_key = ?
      `).run(String(memory.data || ""), memory.timestamp, parsed.namespace, parsed.username, parsed.hostKey);
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
function listSemanticMemoriesByNamespace(namespaceInput, options = {}) {
    const namespace = String(namespaceInput || "").trim().toLowerCase();
    if (!namespace)
        return [];
    const prefix = String(options.prefix || "").trim();
    const limit = Math.max(1, Math.min(5000, Number(options.limit || 500)));
    const like = prefix ? `${prefix}%` : null;
    const rows = like
        ? db_1.db.prepare(`
      SELECT id, namespace, path, operator, data, hash, prevHash, signature, timestamp
      FROM semantic_memories
      WHERE namespace = ? AND path LIKE ?
      ORDER BY id ASC
      LIMIT ?
    `).all(namespace, like, limit)
        : db_1.db.prepare(`
      SELECT id, namespace, path, operator, data, hash, prevHash, signature, timestamp
      FROM semantic_memories
      WHERE namespace = ?
      ORDER BY id ASC
      LIMIT ?
    `).all(namespace, limit);
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
    }));
}
function listSemanticMemoriesByRootNamespace(rootNamespaceInput, options = {}) {
    const rootNamespace = (0, identity_1.normalizeNamespaceRootName)(rootNamespaceInput);
    if (!rootNamespace)
        return [];
    const limit = Math.max(1, Math.min(5000, Number(options.limit || 500)));
    const rows = db_1.db.prepare(`
    SELECT id, namespace, path, operator, data, hash, prevHash, signature, timestamp
    FROM semantic_memories
    ORDER BY id DESC
    LIMIT ?
  `).all(limit * 10);
    return rows
        .map((row) => ({
        id: row.id,
        namespace: row.namespace,
        path: row.path,
        operator: row.operator,
        data: parseJsonSafe(row.data),
        hash: row.hash,
        prevHash: row.prevHash,
        signature: row.signature,
        timestamp: row.timestamp,
    }))
        .filter((row) => (0, identity_1.normalizeNamespaceRootName)(row.namespace) === rootNamespace)
        .slice(0, limit);
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
    WHERE path LIKE ? OR path LIKE ?
    ORDER BY id ASC
  `).all("host.%", "%/hosts/%");
    for (const row of rows) {
        if (username) {
            const parsed = parseHostPath({
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
            if (!parsed || parsed.username !== username)
                continue;
        }
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
    return listHostsByNamespace("", usernameInput);
}
function listHostsByNamespace(namespaceInput, usernameInput) {
    const namespace = String(namespaceInput || "").trim().toLowerCase();
    const username = normalizeUsername(usernameInput);
    if (!username)
        return [];
    const query = namespace
        ? db_1.db.prepare(`
    SELECT
      id,
      namespace,
      username,
      host_key,
      fingerprint,
      public_key,
      hostname,
      label,
      local_endpoint,
      attestation,
      capabilities_json,
      status,
      created_at,
      last_used,
      revoked_at
    FROM authorized_hosts
    WHERE namespace = ? AND username = ?
    ORDER BY last_used DESC
  `)
        : db_1.db.prepare(`
    SELECT
      id,
      namespace,
      username,
      host_key,
      fingerprint,
      public_key,
      hostname,
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
  `);
    return (namespace ? query.all(namespace, username) : query.all(username));
}
function getHostStatus(namespaceInput, usernameInput, fingerprintInput) {
    const namespace = String(namespaceInput || "").trim().toLowerCase();
    const username = normalizeUsername(usernameInput);
    const fingerprint = String(fingerprintInput || "").trim();
    if (!namespace || !username || !fingerprint)
        return null;
    const row = db_1.db.prepare(`
    SELECT status FROM authorized_hosts WHERE username = ? AND fingerprint = ?
    AND namespace = ?
  `).get(username, fingerprint, namespace);
    return row?.status || null;
}
function listHostMemoryHistory(namespaceInput, usernameInput, fingerprintInput, limitInput = 200) {
    const namespace = String(namespaceInput || "").trim().toLowerCase();
    const username = normalizeUsername(usernameInput);
    const fingerprint = String(fingerprintInput || "").trim();
    if (!namespace || !username || !fingerprint)
        return [];
    const limit = Math.max(1, Math.min(2000, Number(limitInput || 200)));
    const host = db_1.db.prepare(`
    SELECT host_key FROM authorized_hosts WHERE namespace = ? AND username = ? AND fingerprint = ?
  `).get(namespace, username, fingerprint);
    const hostKey = normalizeHostKey(String(host?.host_key || fingerprint));
    const modernPrefix = `host.${hostKey}.`;
    const legacyPrefix = `${namespace}/hosts/${fingerprint}/`;
    const rows = db_1.db.prepare(`
    SELECT id, namespace, path, operator, data, hash, prevHash, signature, timestamp
    FROM semantic_memories
    WHERE namespace = ? AND (path LIKE ? OR path LIKE ?)
    ORDER BY id DESC
    LIMIT ?
  `).all(namespace, `${modernPrefix}%`, `${legacyPrefix}%`, limit);
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
        host_key: hostKey,
        username,
        fingerprint,
    }));
}
