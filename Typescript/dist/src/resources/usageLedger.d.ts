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
/**
 * Produces deterministic JSON where all object keys are recursively sorted.
 * Used as the signing input so that `{ b: 1, a: 2 }` and `{ a: 2, b: 1 }`
 * produce identical byte sequences (and thus identical signatures).
 *
 * @internal — exported for test-suite verification only.
 */
export declare function stableJson(value: unknown): string;
/**
 * Per-identity (or anonymous) usage bucket for one window.
 * Keyed by `identityHash` in `GatewayUsageSnapshot.identities`; the null-identity
 * bucket is stored in `GatewayUsageSnapshot.anonymous`.
 */
export interface IdentityUsageBucket {
    requests: number;
    totalDurationMs: number;
    avgDurationMs: number;
    /** HTTP status code → request count.  Keys are stringified numbers ("200", "404", …). */
    statusCodes: Record<string, number>;
    /** Operation label → request count (`"read"`, `"write"`, …). */
    operations: Record<string, number>;
    /** Host name → request count. */
    hosts: Record<string, number>;
}
/**
 * Rolling window aggregate written to `gateway-usage.json`.
 *
 * nginx Lua can read this file (same hot-reload pattern as `domain-map.json`) to
 * make policy decisions: rate-limiting, quota enforcement, billing hooks, etc.
 * The companion `gateway-usage.version` file triggers an in-memory reload without
 * a worker restart.
 */
export interface GatewayUsageSnapshot {
    /** Normalised gateway identifier (hostname, lowercased). */
    gatewayId: string;
    windowStartedAt: number;
    windowEndedAt: number;
    totalRequests: number;
    /** Requests attributed to a known `identityHash`. */
    identities: Record<string, IdentityUsageBucket>;
    /** Requests with no `identityHash` (unauthenticated or pre-auth). */
    anonymous: IdentityUsageBucket;
    /** Host → total request count for the window. */
    byHost: Record<string, number>;
    /** Operation label → total request count for the window. */
    byOperation: Record<string, number>;
    /** System metrics sampled at window end. */
    system: {
        cpuRatio: number;
        memoryRatio: number;
        pressureCpu: number;
    };
    /** SHA-256 of canonical JSON payload (32 hex chars) — change-detection signal. */
    version: string;
    updatedAt: number;
}
/** Signature envelope embedded in every ledger entry. */
export interface LedgerEntrySig {
    /** Always `"ed25519"`. */
    alg: 'ed25519';
    /**
     * Base64-encoded Ed25519 signature over the canonical (sorted-key) JSON of
     * the payload — i.e. the full entry object **without** the `sig` field.
     */
    value: string;
    /**
     * Hex-encoded DER SPKI public key.
     * Use `crypto.createPublicKey({ key: Buffer.from(pubKey, 'hex'), format: 'der', type: 'spki' })`
     * to import for verification.
     */
    pubKey: string;
}
/** Level 1: one entry per surface request (`surface.usage.requests`). */
export interface RequestLedgerEntry {
    /** Identity hash of the authenticated caller, or `null` when unauthenticated. */
    identityHash: string | null;
    /** Monad namespace derived from the request host / routing table. */
    namespace: string;
    method: string;
    url: string;
    status: number;
    durationMs: number;
    host: string;
    operation: string;
    requestedAt: number;
    /** CPU load ratio (0–1) sampled at event time. */
    cpuRatio: number;
    /** RSS / total memory ratio (0–1) sampled at event time. */
    memoryRatio: number;
    sig: LedgerEntrySig;
}
/** Level 2: one aggregate entry per window (`surface.usage.window`). */
export interface WindowLedgerEntry {
    windowStartedAt: number;
    windowEndedAt: number;
    /** Number of requests received in the last 10 s window reported by surfaceTelemetry. */
    requestRate: number;
    cpuRatio: number;
    memoryRatio: number;
    pressureCpu: number;
    sig: LedgerEntrySig;
}
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
export declare class ResourceUsageLedger {
    private readonly _privateKey;
    private readonly _publicKeyHex;
    /** Resolved lazily on first write to avoid triggering kernel init at import time. */
    private _namespace;
    private _pending;
    private _drainScheduled;
    private _windowStart;
    private _windowTimer;
    private _unsubscribe;
    /** Rolling aggregate for the current window — reset after each file export. */
    private _agg;
    constructor();
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
    start(windowMs?: number): this;
    /**
     * Stops the ledger bridge and synchronously drains any buffered events.
     *
     * After `stop()` the instance can be restarted with {@link start}.
     */
    stop(): void;
    /** `true` when the bridge is actively recording. */
    get isRunning(): boolean;
    /**
     * Hex-encoded DER SPKI public key.
     *
     * All entries signed by this instance carry the same `sig.pubKey` value
     * and can be independently verified with this key.
     */
    get publicKeyHex(): string;
    private _resolveNamespace;
    /**
     * Signs `payload` using the instance's private key.
     * The input is serialised with {@link stableJson} (recursively sorted keys)
     * so the signature is stable regardless of property insertion order.
     */
    private _sign;
    private _enqueue;
    private _drainNow;
    /**
     * Writes one Level 1 (per-request) entry to `surface.usage.requests`
     * and accumulates the event into the rolling window aggregate.
     */
    private _writeRequestEntry;
    /**
     * Accumulates one request event into the in-memory rolling aggregate.
     * Called synchronously after each Level 1 write.
     */
    private _accumulate;
    /**
     * Writes one Level 2 (window aggregate) entry to `surface.usage.window`.
     *
     * Called automatically by the internal timer; may also be invoked directly
     * (e.g. during tests or on graceful shutdown for a final snapshot).
     */
    flushWindowSnapshot(): void;
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
    _exportToFile(windowPayload: Omit<WindowLedgerEntry, 'sig'>): void;
    /**
     * Returns the path to `gateway-usage.json` when `NETGET_DATA_DIR` is set,
     * or `null` when the file export is not configured.
     */
    get usageFilePath(): string | null;
}
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
export declare const defaultUsageLedger: ResourceUsageLedger;
