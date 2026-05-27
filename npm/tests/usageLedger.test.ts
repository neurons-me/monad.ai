/**
 * Tests for ResourceUsageLedger.
 *
 * Covers:
 *   - signing key: SEED-derived vs ephemeral
 *   - start / stop lifecycle (isRunning, idempotent start)
 *   - publicKeyHex is a valid importable Ed25519 SPKI key
 *   - Level 1: surface request → entry at surface.usage.requests (after tick)
 *   - Level 1: signature round-trip verification using embedded pubKey
 *   - Level 1: identityHash forwarded when present
 *   - Level 2: flushWindowSnapshot() → entry at surface.usage.window
 *   - Level 2: window timing (endedAt > startedAt, start resets)
 *   - stop() prevents further events from being recorded
 */

import assert from "assert";
import crypto from "crypto";
import fs     from "fs";
import os     from "os";
import path   from "path";
import {
    ResourceUsageLedger,
    stableJson,
    type RequestLedgerEntry,
    type WindowLedgerEntry,
    type GatewayUsageSnapshot,
} from "../src/resources/usageLedger.js";
import { recordSurfaceRequest } from "../src/http/surfaceTelemetry.js";
import { listSemanticMemoriesByNamespace } from "../src/claim/memoryStore.js";

// The test setup (tests/setup.ts) sets process.env.ME_NAMESPACE = "cleaker.me"
const NS = process.env.ME_NAMESPACE ?? "cleaker.me";

// ---------------------------------------------------------------------------
// Helper: wait one setImmediate cycle so _drainNow() fires
// ---------------------------------------------------------------------------

function tick(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Helper: stableJson verification (same algorithm as the signer)
// ---------------------------------------------------------------------------

function countRequestEntries(): number {
    return listSemanticMemoriesByNamespace(NS, {
        prefix: "surface.usage.requests",
        limit: 5_000,
    }).length;
}

function countWindowEntries(): number {
    return listSemanticMemoriesByNamespace(NS, {
        prefix: "surface.usage.window",
        limit: 5_000,
    }).length;
}

function lastRequestEntry(): RequestLedgerEntry | undefined {
    const rows = listSemanticMemoriesByNamespace(NS, {
        prefix: "surface.usage.requests",
        limit: 5_000,
    });
    return rows.length ? (rows[rows.length - 1]!.data as RequestLedgerEntry) : undefined;
}

function lastWindowEntry(): WindowLedgerEntry | undefined {
    const rows = listSemanticMemoriesByNamespace(NS, {
        prefix: "surface.usage.window",
        limit: 5_000,
    });
    return rows.length ? (rows[rows.length - 1]!.data as WindowLedgerEntry) : undefined;
}

// ---------------------------------------------------------------------------
// stableJson — canonical serialisation
// ---------------------------------------------------------------------------

test("stableJson: sorts object keys recursively", () => {
    const out = stableJson({ z: 1, a: 2, m: 3 });
    assert.equal(out, '{"a":2,"m":3,"z":1}');
});

test("stableJson: handles arrays without sorting elements", () => {
    const out = stableJson([3, 1, 2]);
    assert.equal(out, "[3,1,2]");
});

test("stableJson: handles null and primitives", () => {
    assert.equal(stableJson(null), "null");
    assert.equal(stableJson(42), "42");
    assert.equal(stableJson("hello"), '"hello"');
});

test("stableJson: nested objects sort keys at each level", () => {
    const out = stableJson({ b: { y: 1, x: 2 }, a: 0 });
    assert.equal(out, '{"a":0,"b":{"x":2,"y":1}}');
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test("isRunning is false before start()", () => {
    const ledger = new ResourceUsageLedger();
    assert.equal(ledger.isRunning, false);
});

test("start() flips isRunning and returns this", () => {
    const ledger = new ResourceUsageLedger();
    const returned = ledger.start(60_000);
    assert.equal(returned, ledger, "start() returns this for chaining");
    assert.equal(ledger.isRunning, true);
    ledger.stop();
});

test("stop() flips isRunning back to false", () => {
    const ledger = new ResourceUsageLedger();
    ledger.start(60_000);
    ledger.stop();
    assert.equal(ledger.isRunning, false);
});

test("start() is idempotent — calling twice keeps same key and state", () => {
    const ledger = new ResourceUsageLedger();
    ledger.start(60_000);
    const key = ledger.publicKeyHex;
    ledger.start(60_000);   // second call: no-op
    assert.equal(ledger.publicKeyHex, key);
    assert.equal(ledger.isRunning, true);
    ledger.stop();
});

// ---------------------------------------------------------------------------
// Signing key
// ---------------------------------------------------------------------------

test("publicKeyHex is a valid importable Ed25519 SPKI public key", () => {
    const ledger = new ResourceUsageLedger();
    const pubKey = crypto.createPublicKey({
        key:    Buffer.from(ledger.publicKeyHex, "hex"),
        format: "der",
        type:   "spki",
    });
    assert.equal(pubKey.asymmetricKeyType, "ed25519");
});

test("SEED-derived key is deterministic across instances", () => {
    // Both instances are created with the same process.env.SEED (set in setup.ts)
    const a = new ResourceUsageLedger();
    const b = new ResourceUsageLedger();
    assert.equal(a.publicKeyHex, b.publicKeyHex, "same SEED → same derived public key");
});

// ---------------------------------------------------------------------------
// Level 1 — per-request entries
// ---------------------------------------------------------------------------

test("Level 1: request event written to surface.usage.requests after tick", async () => {
    const ledger = new ResourceUsageLedger();
    ledger.start(60_000);

    const before = countRequestEntries();

    recordSurfaceRequest({
        method:       "GET",
        url:          "/test/usage-ledger-l1",
        status:       200,
        durationMs:   55,
        host:         "local.netget",
        namespace:    NS,
        operation:    "read",
        nrp:          "",
        lens:         "",
        forwardedHost: null,
    });

    await tick();

    const after = countRequestEntries();
    assert.ok(after > before, "entry count increased after request event");

    const entry = lastRequestEntry()!;
    assert.equal(entry.method,    "GET");
    assert.equal(entry.url,       "/test/usage-ledger-l1");
    assert.equal(entry.status,    200);
    assert.equal(entry.durationMs, 55);
    assert.equal(entry.host,      "local.netget");
    assert.equal(entry.operation, "read");
    assert.ok(typeof entry.cpuRatio    === "number", "cpuRatio is a number");
    assert.ok(typeof entry.memoryRatio === "number", "memoryRatio is a number");
    assert.ok(entry.cpuRatio    >= 0 && entry.cpuRatio    <= 1, "cpuRatio in [0,1]");
    assert.ok(entry.memoryRatio >= 0 && entry.memoryRatio <= 1, "memoryRatio in [0,1]");
    assert.ok(entry.requestedAt > 0, "requestedAt is a positive timestamp");

    ledger.stop();
});

test("Level 1: identityHash forwarded when present", async () => {
    const ledger = new ResourceUsageLedger();
    ledger.start(60_000);

    const HASH = "aabbcc001122deadbeef000000000000000000000000000000000000000000ff01";

    recordSurfaceRequest({
        method:       "POST",
        url:          "/claims/action",
        status:       201,
        durationMs:   12,
        host:         "local.netget",
        namespace:    NS,
        operation:    "write",
        nrp:          "",
        lens:         "",
        forwardedHost: null,
        identityHash: HASH,
    });

    await tick();

    const entry = lastRequestEntry()!;
    assert.equal(entry.identityHash, HASH, "identityHash preserved in ledger entry");

    ledger.stop();
});

test("Level 1: null identityHash when not provided", async () => {
    const ledger = new ResourceUsageLedger();
    ledger.start(60_000);

    recordSurfaceRequest({
        method:       "GET",
        url:          "/public/route",
        status:       200,
        durationMs:   5,
        host:         "local.netget",
        namespace:    NS,
        operation:    "read",
        nrp:          "",
        lens:         "",
        forwardedHost: null,
    });

    await tick();

    const entry = lastRequestEntry()!;
    assert.equal(entry.identityHash, null, "identityHash is null when not provided");

    ledger.stop();
});

// ---------------------------------------------------------------------------
// Level 1 — signature verification
// ---------------------------------------------------------------------------

test("Level 1: signature verifies against embedded pubKey", async () => {
    const ledger = new ResourceUsageLedger();
    ledger.start(60_000);

    recordSurfaceRequest({
        method:       "PUT",
        url:          "/chain/signed-entry",
        status:       200,
        durationMs:   7,
        host:         "local.netget",
        namespace:    NS,
        operation:    "write",
        nrp:          "",
        lens:         "",
        forwardedHost: null,
    });

    await tick();

    const entry = lastRequestEntry()!;
    const { sig, ...payload } = entry;

    // Import the public key from the entry itself.
    const pubKey = crypto.createPublicKey({
        key:    Buffer.from(sig.pubKey, "hex"),
        format: "der",
        type:   "spki",
    });

    // Reconstruct the canonical signing input: stableJson of the payload.
    const canonical = Buffer.from(stableJson(payload as unknown as Record<string, unknown>), "utf8");
    const valid = crypto.verify(null, canonical, pubKey, Buffer.from(sig.value, "base64"));

    assert.ok(valid, "signature in entry verifies against embedded public key");

    ledger.stop();
});

test("Level 1: tampering payload invalidates signature", async () => {
    const ledger = new ResourceUsageLedger();
    ledger.start(60_000);

    recordSurfaceRequest({
        method:       "DELETE",
        url:          "/tamper-test",
        status:       204,
        durationMs:   3,
        host:         "local.netget",
        namespace:    NS,
        operation:    "delete",
        nrp:          "",
        lens:         "",
        forwardedHost: null,
    });

    await tick();

    const entry = lastRequestEntry()!;
    const { sig, ...payload } = entry;

    // Tamper: change the status code
    const tampered = { ...payload, status: 500 };

    const pubKey = crypto.createPublicKey({
        key:    Buffer.from(sig.pubKey, "hex"),
        format: "der",
        type:   "spki",
    });

    const canonical = Buffer.from(stableJson(tampered as unknown as Record<string, unknown>), "utf8");
    const valid = crypto.verify(null, canonical, pubKey, Buffer.from(sig.value, "base64"));

    assert.equal(valid, false, "tampered payload fails signature verification");

    ledger.stop();
});

// ---------------------------------------------------------------------------
// Level 2 — window snapshots
// ---------------------------------------------------------------------------

test("Level 2: flushWindowSnapshot() writes to surface.usage.window", () => {
    const ledger = new ResourceUsageLedger();
    // Do NOT call start() — invoke the snapshot directly to avoid timer side-effects.

    const before = countWindowEntries();

    ledger.flushWindowSnapshot();

    const after = countWindowEntries();
    assert.ok(after > before, "window snapshot entry written");

    const entry = lastWindowEntry()!;
    assert.ok(typeof entry.windowStartedAt === "number", "windowStartedAt present");
    assert.ok(typeof entry.windowEndedAt   === "number", "windowEndedAt present");
    assert.ok(typeof entry.requestRate     === "number", "requestRate present");
    assert.ok(typeof entry.cpuRatio        === "number", "cpuRatio present");
    assert.ok(typeof entry.memoryRatio     === "number", "memoryRatio present");
    assert.ok(typeof entry.pressureCpu     === "number", "pressureCpu present");
    assert.ok(entry.windowEndedAt >= entry.windowStartedAt,
        "windowEndedAt ≥ windowStartedAt");
    assert.equal(entry.sig.alg, "ed25519", "sig.alg is ed25519");
    assert.ok(entry.sig.value.length > 0, "sig.value non-empty");
    assert.ok(entry.sig.pubKey.length > 0, "sig.pubKey non-empty");
});

test("Level 2: consecutive flushWindowSnapshot() resets window start", () => {
    const ledger = new ResourceUsageLedger();

    ledger.flushWindowSnapshot();
    const first = lastWindowEntry()!;

    // Small delay to ensure the second window has a later startedAt
    const now = Date.now();
    while (Date.now() - now < 2) { /* busy-wait 2ms */ }

    ledger.flushWindowSnapshot();
    const second = lastWindowEntry()!;

    assert.ok(
        second.windowStartedAt >= first.windowEndedAt,
        "second window start ≥ first window end (no gap / overlap)",
    );
    assert.ok(second.windowEndedAt > second.windowStartedAt,
        "second window endedAt > startedAt");
});

test("Level 2: window snapshot signature verifies", () => {
    const ledger = new ResourceUsageLedger();
    ledger.flushWindowSnapshot();

    const entry = lastWindowEntry()!;
    const { sig, ...payload } = entry;

    const pubKey = crypto.createPublicKey({
        key:    Buffer.from(sig.pubKey, "hex"),
        format: "der",
        type:   "spki",
    });

    const canonical = Buffer.from(stableJson(payload as unknown as Record<string, unknown>), "utf8");
    const valid = crypto.verify(null, canonical, pubKey, Buffer.from(sig.value, "base64"));

    assert.ok(valid, "window snapshot signature verifies against embedded public key");
});

// ---------------------------------------------------------------------------
// stop() guard
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Level 3 — rolling aggregate + file export
// ---------------------------------------------------------------------------

test("Level 3: _exportToFile writes gateway-usage.json when NETGET_DATA_DIR is set", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "monad-usage-export-test-"));

    try {
        const saved = process.env.NETGET_DATA_DIR;
        process.env.NETGET_DATA_DIR = tmpDir;

        const ledger = new ResourceUsageLedger();
        ledger.start(60_000);

        const HASH = "aabbcc001122deadbeef000000000000000000000000000000000000000000ab01";

        // Fire two requests — one attributed, one anonymous
        recordSurfaceRequest({
            method: "GET", url: "/attributed", status: 200, durationMs: 30,
            host: "local.netget", namespace: NS, operation: "read",
            nrp: "", lens: "", forwardedHost: null,
            identityHash: HASH,
        });
        recordSurfaceRequest({
            method: "POST", url: "/anonymous", status: 201, durationMs: 15,
            host: "local.netget", namespace: NS, operation: "write",
            nrp: "", lens: "", forwardedHost: null,
        });

        await tick();

        // Flush window → triggers _exportToFile
        ledger.flushWindowSnapshot();

        const outPath = path.join(tmpDir, "runtime", "gateway-usage.json");
        const verPath = path.join(tmpDir, "runtime", "gateway-usage.version");

        assert.ok(fs.existsSync(outPath),  "gateway-usage.json created");
        assert.ok(fs.existsSync(verPath),  "gateway-usage.version created");

        const snap: GatewayUsageSnapshot = JSON.parse(fs.readFileSync(outPath, "utf8"));

        assert.ok(snap.totalRequests >= 2,   "totalRequests >= 2");
        assert.ok(snap.identities[HASH],     "attributed identity present");
        assert.ok(snap.identities[HASH]!.requests >= 1, "attributed requests counted");
        assert.ok(snap.anonymous.requests >= 1, "anonymous requests counted");
        assert.ok(snap.byHost["local.netget"] >= 2, "byHost counts present");
        assert.ok(snap.byOperation["read"]  >= 1, "read ops counted");
        assert.ok(snap.byOperation["write"] >= 1, "write ops counted");
        assert.ok(typeof snap.system.cpuRatio    === "number", "system.cpuRatio present");
        assert.ok(typeof snap.system.memoryRatio === "number", "system.memoryRatio present");
        assert.ok(typeof snap.system.pressureCpu === "number", "system.pressureCpu present");
        assert.ok(snap.version.length === 32, "version is 32 hex chars");
        assert.equal(snap.version, fs.readFileSync(verPath, "utf8"),
            "version file matches snapshot.version");
        assert.ok(snap.windowEndedAt >= snap.windowStartedAt, "window timing valid");

        ledger.stop();
        process.env.NETGET_DATA_DIR = saved;
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("Level 3: avgDurationMs is correct", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "monad-usage-avg-test-"));

    try {
        const saved = process.env.NETGET_DATA_DIR;
        process.env.NETGET_DATA_DIR = tmpDir;

        const ledger = new ResourceUsageLedger();
        ledger.start(60_000);

        const HASH = "aabbcc001122deadbeef000000000000000000000000000000000000000000cd02";

        // Two requests: 100ms + 200ms → avg 150ms
        recordSurfaceRequest({ method: "GET", url: "/a", status: 200, durationMs: 100,
            host: "h", namespace: NS, operation: "read", nrp: "", lens: "",
            forwardedHost: null, identityHash: HASH });
        recordSurfaceRequest({ method: "GET", url: "/b", status: 200, durationMs: 200,
            host: "h", namespace: NS, operation: "read", nrp: "", lens: "",
            forwardedHost: null, identityHash: HASH });

        await tick();
        ledger.flushWindowSnapshot();

        const snap: GatewayUsageSnapshot = JSON.parse(
            fs.readFileSync(path.join(tmpDir, "runtime", "gateway-usage.json"), "utf8")
        );

        const bucket = snap.identities[HASH]!;
        assert.equal(bucket.requests,        2,   "2 requests");
        assert.equal(bucket.totalDurationMs, 300, "total 300ms");
        assert.equal(bucket.avgDurationMs,   150, "avg 150ms");

        ledger.stop();
        process.env.NETGET_DATA_DIR = saved;
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("Level 3: aggregate resets after each window flush", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "monad-usage-reset-test-"));

    try {
        const saved = process.env.NETGET_DATA_DIR;
        process.env.NETGET_DATA_DIR = tmpDir;

        const ledger = new ResourceUsageLedger();
        ledger.start(60_000);

        // First window: 3 requests
        for (let i = 0; i < 3; i++) {
            recordSurfaceRequest({ method: "GET", url: "/w1", status: 200, durationMs: 10,
                host: "h", namespace: NS, operation: "read", nrp: "", lens: "",
                forwardedHost: null });
        }
        await tick();
        ledger.flushWindowSnapshot();

        const snap1: GatewayUsageSnapshot = JSON.parse(
            fs.readFileSync(path.join(tmpDir, "runtime", "gateway-usage.json"), "utf8")
        );

        // Second window: 1 request
        recordSurfaceRequest({ method: "GET", url: "/w2", status: 200, durationMs: 5,
            host: "h", namespace: NS, operation: "read", nrp: "", lens: "",
            forwardedHost: null });
        await tick();
        ledger.flushWindowSnapshot();

        const snap2: GatewayUsageSnapshot = JSON.parse(
            fs.readFileSync(path.join(tmpDir, "runtime", "gateway-usage.json"), "utf8")
        );

        assert.ok(snap1.totalRequests >= 3,
            "first window captured ≥ 3 requests");
        assert.ok(snap2.totalRequests >= 1 && snap2.totalRequests < snap1.totalRequests,
            "second window captured fewer requests (aggregate reset between windows)");
        assert.notEqual(snap1.version, snap2.version,
            "version differs between windows");

        ledger.stop();
        process.env.NETGET_DATA_DIR = saved;
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("Level 3: usageFilePath returns path when NETGET_DATA_DIR is set", () => {
    const saved = process.env.NETGET_DATA_DIR;
    process.env.NETGET_DATA_DIR = "/tmp/test-netget-dir";

    const ledger = new ResourceUsageLedger();
    assert.ok(ledger.usageFilePath!.endsWith("gateway-usage.json"),
        "usageFilePath ends with gateway-usage.json");

    process.env.NETGET_DATA_DIR = saved;
});

test("Level 3: usageFilePath is null when NETGET_DATA_DIR is not set", () => {
    const saved = process.env.NETGET_DATA_DIR;
    delete process.env.NETGET_DATA_DIR;

    const ledger = new ResourceUsageLedger();
    assert.equal(ledger.usageFilePath, null, "usageFilePath is null without NETGET_DATA_DIR");

    process.env.NETGET_DATA_DIR = saved;
});

// ---------------------------------------------------------------------------
// stop() guard
// ---------------------------------------------------------------------------

test("stop() prevents further events from being written", async () => {
    const ledger = new ResourceUsageLedger();
    ledger.start(60_000);
    ledger.stop();

    const before = countRequestEntries();

    recordSurfaceRequest({
        method:       "GET",
        url:          "/should-not-appear-after-stop",
        status:       200,
        durationMs:   1,
        host:         "local.netget",
        namespace:    NS,
        operation:    "read",
        nrp:          "",
        lens:         "",
        forwardedHost: null,
    });

    await tick();

    const after = countRequestEntries();
    assert.equal(after, before, "no new entries written after stop()");
});
