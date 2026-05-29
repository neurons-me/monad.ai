/**
 * @module ResourceUsageLedger
 * @memberof module:monad.resources
 *
 * Materialises in-memory surface telemetry into signed semantic ledger entries.
 *
 * ## Why this bridge exists
 *
 * `surfaceTelemetry.ts` collects per-request events and system metrics in RAM
 * only — data is lost on restart and cannot be audited or aggregated across
 * sessions.  This module writes the same data into the kernel-backed semantic
 * ledger so it becomes part of the content-addressed memory chain.  NetGet
 * and downstream accounting consumers (the "resource crypto") can then read
 * signed, time-ordered entries without touching monad's HTTP layer.
 *
 * ## Two recording levels
 *
 *   **Level 1 — per-request** (`surface.usage.requests`)
 *   Subscribed via `addSurfaceRequestListener`; drained asynchronously on the
 *   next `setImmediate` tick so the request response is never delayed.
 *   Payload: identityHash, namespace, method, url, status, durationMs, host,
 *   operation, requestedAt, cpuRatio, memoryRatio.
 *
 *   **Level 2 — window snapshots** (`surface.usage.window`)
 *   Written on a configurable interval (default 10 s).
 *   Payload: windowStartedAt, windowEndedAt, requestRate, cpuRatio,
 *   memoryRatio, pressureCpu.
 *
 * ## Entry signatures
 *
 * Every entry embeds a `sig` object:
 *   - `alg`    — `"ed25519"`
 *   - `value`  — base64 Ed25519 signature over the canonical (sorted-key) JSON
 *                of the payload fields (everything except `sig` itself)
 *   - `pubKey` — hex SPKI public key for independent verification
 *
 * The signing key is derived deterministically from the monad SEED via
 * HKDF-SHA-256 (`info = "resource-signing-key-v1"`).  This ensures entries
 * from the same monad instance are always signed by the same key, making
 * historical audit possible.  When no SEED is present (e.g. pure unit tests)
 * a fresh ephemeral Ed25519 keypair is generated.
 *
 * ## Integration
 *
 * ```typescript
 * // In your monad bootstrap sequence (after ensureRootSemanticBootstrap):
 * import { defaultUsageLedger } from './resources/usageLedger.js';
 * defaultUsageLedger.start();
 * ```
 *
 * @see {@link module:monad.http.surfaceTelemetry}
 * @see {@link module:monad.claim.memoryStore}
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { appendSemanticMemory } from '../claim/memoryStore.js';
import { getRootNamespace } from '../kernel/manager.js';
import { addSurfaceRequestListener, getSurfaceTelemetrySnapshot, } from '../http/surfaceTelemetry.js';
// ---------------------------------------------------------------------------
// Deterministic signing-key derivation
// ---------------------------------------------------------------------------
/**
 * Derives a stable Ed25519 private key from the monad SEED via HKDF-SHA-256.
 *
 * The PKCS #8 DER wrapper for Ed25519 is the fixed 16-byte prefix defined in
 * RFC 8410, followed by the 32-byte raw private key seed produced by HKDF.
 *
 * Falls back to an ephemeral randomly-generated keypair when no SEED is set
 * (e.g. during isolated unit tests that do not load the kernel).
 */
function resolveSigningKey() {
    const seed = (process.env.SEED ?? process.env.ME_SEED ?? '').trim();
    if (seed) {
        try {
            // 32 bytes of deterministic key material from the daemon SEED.
            const material = Buffer.from(crypto.hkdfSync('sha256', seed, 'monad-usage-ledger', 'resource-signing-key-v1', 32));
            // PKCS #8 v1 wrapper for Ed25519 (RFC 8410 §10.3):
            //   30 2e                 — SEQUENCE, length 46
            //     02 01 00            — INTEGER 0 (version)
            //     30 05               — SEQUENCE, length 5
            //       06 03 2b 65 70    — OID 1.3.101.112 (id-EdDSA / Ed25519)
            //     04 22               — OCTET STRING, length 34
            //       04 20             — OCTET STRING, length 32
            //       <32 bytes>        — private key seed
            const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
            return crypto.createPrivateKey({
                key: Buffer.concat([pkcs8Header, material]),
                format: 'der',
                type: 'pkcs8',
            });
        }
        catch {
            // Fall through — HKDF or key import failed (unusual), use ephemeral key.
        }
    }
    return crypto.generateKeyPairSync('ed25519').privateKey;
}
// ---------------------------------------------------------------------------
// Local measurement helpers
// ---------------------------------------------------------------------------
/** CPU load ratio (0–1) based on the 1-minute load average across all cores. */
function computeCpuRatio() {
    const cores = Math.max(1, os.cpus()?.length ?? 1);
    const load = Number(os.loadavg?.()[0] ?? 0);
    const ratio = load / cores;
    return Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
}
/** Resident set size divided by total physical memory (0–1). */
function computeMemoryRatio() {
    const total = os.totalmem();
    if (total <= 0)
        return 0;
    const rss = process.memoryUsage().rss;
    return Math.min(1, rss / total);
}
// ---------------------------------------------------------------------------
// Canonical serialisation
// ---------------------------------------------------------------------------
/**
 * Produces deterministic JSON where all object keys are recursively sorted.
 * Used as the signing input so that `{ b: 1, a: 2 }` and `{ a: 2, b: 1 }`
 * produce identical byte sequences (and thus identical signatures).
 *
 * @internal — exported for test-suite verification only.
 */
export function stableJson(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(',')}]`;
    }
    const obj = value;
    const keys = Object.keys(obj).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`;
}
function freshBucket() {
    return { requests: 0, totalDurationMs: 0, statusCodes: {}, operations: {}, hosts: {} };
}
function freshAggregate() {
    return { byIdentity: new Map(), byHost: new Map(), byOperation: new Map(), total: 0 };
}
function bucketToPublic(b) {
    return {
        requests: b.requests,
        totalDurationMs: b.totalDurationMs,
        avgDurationMs: b.requests > 0 ? Math.round(b.totalDurationMs / b.requests) : 0,
        statusCodes: { ...b.statusCodes },
        operations: { ...b.operations },
        hosts: { ...b.hosts },
    };
}
function normalizeHostname(h) {
    return h.trim().toLowerCase().replace(/\s+/g, '-');
}
function computeSnapshotVersion(snap) {
    return crypto.createHash('sha256')
        .update(stableJson(snap), 'utf8')
        .digest('hex')
        .slice(0, 32);
}
// ---------------------------------------------------------------------------
// ResourceUsageLedger
// ---------------------------------------------------------------------------
/**
 * Bridges surface telemetry into the semantic ledger.
 *
 * Create one instance per monad daemon and call {@link start} during bootstrap.
 * No recording happens until `start()` is called, so the module is safe to
 * import before the kernel is initialised.
 *
 * @example
 * ```typescript
 * import { defaultUsageLedger } from './resources/usageLedger.js';
 *
 * // After ensureRootSemanticBootstrap() and kernel hydration:
 * defaultUsageLedger.start();
 *
 * // On graceful shutdown:
 * defaultUsageLedger.stop();
 * ```
 */
export class ResourceUsageLedger {
    constructor() {
        /** Resolved lazily on first write to avoid triggering kernel init at import time. */
        this._namespace = null;
        this._pending = [];
        this._drainScheduled = false;
        this._windowStart = 0;
        this._windowTimer = null;
        this._unsubscribe = null;
        /** Rolling aggregate for the current window — reset after each file export. */
        this._agg = freshAggregate();
        this._privateKey = resolveSigningKey();
        this._publicKeyHex = crypto
            .createPublicKey(this._privateKey)
            .export({ type: 'spki', format: 'der' })
            .toString('hex');
    }
    // ── Lifecycle ─────────────────────────────────────────────────────────────
    /**
     * Starts the ledger bridge.
     *
     * Subscribes to surface request events and arms the window snapshot timer.
     * Subsequent calls while already running are silently ignored.
     *
     * @param windowMs - Window snapshot interval in milliseconds.  Default: 10 000.
     *   Values below 1 000 are clamped to 1 000.
     * @returns `this` for chaining.
     */
    start(windowMs = 10000) {
        if (this._unsubscribe)
            return this; // already running
        this._windowStart = Date.now();
        this._unsubscribe = addSurfaceRequestListener(e => this._enqueue(e));
        const interval = Math.max(1000, windowMs);
        this._windowTimer = setInterval(() => this.flushWindowSnapshot(), interval);
        // Unref so the timer does not prevent clean process exit.
        this._windowTimer.unref?.();
        return this;
    }
    /**
     * Stops the ledger bridge and synchronously drains any buffered events.
     *
     * After `stop()` the instance can be restarted with {@link start}.
     */
    stop() {
        this._unsubscribe?.();
        this._unsubscribe = null;
        if (this._windowTimer) {
            clearInterval(this._windowTimer);
            this._windowTimer = null;
        }
        // Flush remaining buffered Level 1 events before teardown.
        this._drainNow();
    }
    /** `true` when the bridge is actively recording. */
    get isRunning() {
        return this._unsubscribe !== null;
    }
    /**
     * Hex-encoded DER SPKI public key.
     *
     * All entries signed by this instance carry the same `sig.pubKey` value
     * and can be independently verified with this key.
     */
    get publicKeyHex() {
        return this._publicKeyHex;
    }
    // ── Internal helpers ──────────────────────────────────────────────────────
    _resolveNamespace() {
        if (!this._namespace) {
            try {
                this._namespace = getRootNamespace();
            }
            catch {
                this._namespace = 'unknown';
            }
        }
        return this._namespace;
    }
    /**
     * Signs `payload` using the instance's private key.
     * The input is serialised with {@link stableJson} (recursively sorted keys)
     * so the signature is stable regardless of property insertion order.
     */
    _sign(payload) {
        const data = Buffer.from(stableJson(payload), 'utf8');
        const value = crypto.sign(null, data, this._privateKey).toString('base64');
        return { alg: 'ed25519', value, pubKey: this._publicKeyHex };
    }
    _enqueue(event) {
        this._pending.push(event);
        if (!this._drainScheduled) {
            this._drainScheduled = true;
            // Drain on the next I/O cycle — never blocks the request response.
            setImmediate(() => this._drainNow());
        }
    }
    _drainNow() {
        this._drainScheduled = false;
        const events = this._pending.splice(0);
        for (const event of events) {
            this._writeRequestEntry(event);
        }
    }
    /**
     * Writes one Level 1 (per-request) entry to `surface.usage.requests`
     * and accumulates the event into the rolling window aggregate.
     */
    _writeRequestEntry(event) {
        const payload = {
            identityHash: event.identityHash ?? null,
            namespace: event.namespace || this._resolveNamespace(),
            method: event.method,
            url: event.url,
            status: event.status,
            durationMs: event.durationMs,
            host: event.host,
            operation: event.operation,
            requestedAt: event.timestamp,
            cpuRatio: computeCpuRatio(),
            memoryRatio: computeMemoryRatio(),
        };
        try {
            appendSemanticMemory({
                namespace: this._resolveNamespace(),
                path: 'surface.usage.requests',
                data: { ...payload, sig: this._sign(payload) },
            });
        }
        catch {
            // Silently ignore — ledger writes must never affect request handling.
        }
        // Accumulate into the rolling window aggregate regardless of ledger success.
        this._accumulate(payload);
    }
    /**
     * Accumulates one request event into the in-memory rolling aggregate.
     * Called synchronously after each Level 1 write.
     */
    _accumulate(payload) {
        const key = payload.identityHash ?? null;
        if (!this._agg.byIdentity.has(key)) {
            this._agg.byIdentity.set(key, freshBucket());
        }
        const b = this._agg.byIdentity.get(key);
        b.requests++;
        b.totalDurationMs += payload.durationMs;
        const sc = String(payload.status);
        b.statusCodes[sc] = (b.statusCodes[sc] ?? 0) + 1;
        b.operations[payload.operation] = (b.operations[payload.operation] ?? 0) + 1;
        b.hosts[payload.host] = (b.hosts[payload.host] ?? 0) + 1;
        this._agg.byHost.set(payload.host, (this._agg.byHost.get(payload.host) ?? 0) + 1);
        this._agg.byOperation.set(payload.operation, (this._agg.byOperation.get(payload.operation) ?? 0) + 1);
        this._agg.total++;
    }
    /**
     * Writes one Level 2 (window aggregate) entry to `surface.usage.window`.
     *
     * Called automatically by the internal timer; may also be invoked directly
     * (e.g. during tests or on graceful shutdown for a final snapshot).
     */
    flushWindowSnapshot() {
        const now = Date.now();
        const snap = getSurfaceTelemetrySnapshot();
        const payload = {
            windowStartedAt: this._windowStart,
            windowEndedAt: now,
            requestRate: snap.usage.requestRatePer10s,
            cpuRatio: snap.usage.cpu,
            memoryRatio: computeMemoryRatio(),
            pressureCpu: snap.pressure.cpu,
        };
        // Advance the window start for the next snapshot.
        this._windowStart = now;
        try {
            appendSemanticMemory({
                namespace: this._resolveNamespace(),
                path: 'surface.usage.window',
                data: { ...payload, sig: this._sign(payload) },
            });
        }
        catch {
            // Silently ignore — telemetry must never crash the daemon.
        }
        // Level 3: export aggregated gateway-usage.json if NETGET_DATA_DIR is set.
        // Runs after the ledger write so any failure here never blocks Level 2.
        this._exportToFile(payload);
        // Reset the rolling aggregate for the next window.
        this._agg = freshAggregate();
    }
    // ── File export (Level 3) ─────────────────────────────────────────────────
    /**
     * Atomically writes `gateway-usage.json` + `gateway-usage.version` to
     * `$NETGET_DATA_DIR/runtime/`.
     *
     * This is the same atomic-rename + version-file pattern used by
     * `domain-map.json` and `gateway-claims.json` so nginx Lua workers
     * hot-reload the table without a worker restart.
     *
     * Called automatically at the end of every window flush when `NETGET_DATA_DIR`
     * is set in the environment.  Safe to call manually at any point.
     *
     * @param windowPayload - The Level 2 payload from the most recent window flush.
     */
    _exportToFile(windowPayload) {
        const netgetDir = (process.env.NETGET_DATA_DIR ?? '').trim();
        if (!netgetDir)
            return;
        // Build per-identity map
        const identities = {};
        let anonymous = bucketToPublic(freshBucket());
        for (const [key, bucket] of this._agg.byIdentity) {
            if (key === null) {
                anonymous = bucketToPublic(bucket);
            }
            else {
                identities[key] = bucketToPublic(bucket);
            }
        }
        const snapBase = {
            gatewayId: normalizeHostname(os.hostname()),
            windowStartedAt: windowPayload.windowStartedAt,
            windowEndedAt: windowPayload.windowEndedAt,
            totalRequests: this._agg.total,
            identities,
            anonymous,
            byHost: Object.fromEntries(this._agg.byHost),
            byOperation: Object.fromEntries(this._agg.byOperation),
            system: {
                cpuRatio: windowPayload.cpuRatio,
                memoryRatio: windowPayload.memoryRatio,
                pressureCpu: windowPayload.pressureCpu,
            },
        };
        const now = Date.now();
        const snapshot = {
            ...snapBase,
            version: computeSnapshotVersion(snapBase),
            updatedAt: now,
        };
        const runtimeDir = path.join(netgetDir, 'runtime');
        const outPath = path.join(runtimeDir, 'gateway-usage.json');
        const versionPath = path.join(runtimeDir, 'gateway-usage.version');
        const tmpPath = `${outPath}.tmp`;
        try {
            fs.mkdirSync(runtimeDir, { recursive: true });
            fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf8');
            fs.renameSync(tmpPath, outPath);
            fs.writeFileSync(versionPath, snapshot.version, 'utf8');
        }
        catch {
            // Never let a file write failure crash the daemon.
        }
    }
    /**
     * Returns the path to `gateway-usage.json` when `NETGET_DATA_DIR` is set,
     * or `null` when the file export is not configured.
     */
    get usageFilePath() {
        const d = (process.env.NETGET_DATA_DIR ?? '').trim();
        return d ? path.join(d, 'runtime', 'gateway-usage.json') : null;
    }
}
// ---------------------------------------------------------------------------
// Process-wide singleton
// ---------------------------------------------------------------------------
/**
 * Process-wide usage ledger instance.
 *
 * Import and call `defaultUsageLedger.start()` once during daemon bootstrap
 * (after the kernel has been initialised).  No recording happens until `start()`
 * is called, so importing this module before the kernel is ready is safe.
 *
 * @example
 * ```typescript
 * import { defaultUsageLedger } from './resources/usageLedger.js';
 *
 * // In monad bootstrap, after ensureRootSemanticBootstrap():
 * defaultUsageLedger.start();
 * ```
 */
export const defaultUsageLedger = new ResourceUsageLedger();
