import express from "express";
import cors from "cors";
import os from "os";
import { createHash } from "crypto";
import { db, DB_PATH } from "./src/Blockchain/db";
import { appendBlock, getAllBlocks } from "./src/Blockchain/blockchain";
import { getAllUsers } from "./src/Blockchain/users";
import { claimNamespace, openNamespace } from "./src/claim/records";
import { getMemoriesForNamespace } from "./src/claim/replay";
import { getClaim } from "./src/claim/records";
import { isNamespaceWriteAuthorized, recordMemory } from "./src/claim/replay";
import {
  filterBlocksByNamespace,
  resolveHostNamespace,
  resolveLens,
  resolveNamespace,
} from "./src/http/namespace";
import { normalizeHttpRequestToMeTarget } from "./src/http/meTarget";
import { createEnvelope, createErrorEnvelope } from "./src/http/envelope";
import { createPathResolverHandler } from "./src/http/pathResolver";
import { createClaimsRouter } from "./src/http/claims";
import { createSessionRouter } from "./src/http/session";
import { createLegacyRouter } from "./src/http/legacy";
import { GUI_PKG_DIST_DIR, htmlShell, wantsHtml } from "./src/http/shell";

const PORT = process.env.PORT || 8161;
const NODE_HOSTNAME = os.hostname();
const NODE_DISPLAY_NAME = `${NODE_HOSTNAME}:${PORT}`;
const app = express();
app.set("trust proxy", true);
app.use(cors());
app.use(express.json());

type BridgeTarget = {
  namespace: string;
  selector: string;
  pathSlash: string;
  pathDot: string;
  meTarget: string;
};

type ClaimIdentity = {
  host: string;
  username: string;
  effective: string;
};

function parseBridgeTarget(rawInput: string): BridgeTarget | null {
  const raw = String(rawInput || "").trim();
  if (!raw) return null;

  const stripped = raw.startsWith("me://") ? raw.slice("me://".length) : raw;
  const sanitized = stripped.replace(/^\/+/, "").trim();
  if (!sanitized) return null;

  const parts = sanitized.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  const head = parts[0];
  if (!head) return null;

  const headParts = head.split(":");
  const namespace = String(headParts[0] || "").trim();
  if (!namespace) return null;

  const selector = String(headParts[1] || "read").trim() || "read";
  const pathParts = parts.slice(1);
  const pathSlash = pathParts.join("/");
  const pathDot = pathParts.join(".");
  const meTarget = `me://${namespace}:${selector}/${pathDot || "_"}`;

  return {
    namespace,
    selector,
    pathSlash,
    pathDot,
    meTarget,
  };
}

function toStableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => toStableJson(item)).join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${toStableJson(obj[key])}`);
  return `{${entries.join(",")}}`;
}

function computeProofId(input: Record<string, unknown>) {
  return createHash("sha256").update(toStableJson(input)).digest("hex");
}

function parseNamespaceIdentity(namespace: string): ClaimIdentity {
  const ns = String(namespace || "").trim().toLowerCase();
  if (!ns) {
    return {
      host: "unknown",
      username: "",
      effective: "unclaimed",
    };
  }

  const userMatch = ns.match(/^([^\/]+)\/users\/([^\/]+)$/i);
  if (userMatch) {
    const host = String(userMatch[1] || "").trim();
    const username = String(userMatch[2] || "").trim();
    return {
      host,
      username,
      effective: `@${username}.${host}`,
    };
  }

  return {
    host: ns,
    username: "",
    effective: `@${ns}`,
  };
}

function getDefaultReadPolicy(namespace: string) {
  const identity = parseNamespaceIdentity(namespace);
  const allowed = ["profile/*", "me/public/*", `${namespace}/*`];
  if (identity.host) {
    allowed.push(`${identity.host}/*`);
  }
  return {
    allowed,
    capabilities: ["read"],
  };
}

function normalizeOperation(input: unknown): "read" | "write" | "claim" | "open" {
  const raw = String(input || "").trim().toLowerCase();
  if (raw === "claim" || raw === "open" || raw === "read" || raw === "write") {
    return raw as "read" | "write" | "claim" | "open";
  }
  return "write";
}

function buildBridgeTarget(resolved: BridgeTarget | null, requestHost: string, rawFallback = "") {
  const namespaceMe = resolved?.namespace || "unknown";
  const meTarget = resolved?.meTarget || rawFallback || `me://${namespaceMe}:read/_`;
  return {
    namespace: {
      me: namespaceMe,
      host: requestHost,
    },
    operation: "read" as const,
    path: resolved?.pathDot || "",
    meTarget,
  };
}

function buildNormalizedTarget(
  req: express.Request,
  namespace: string,
  operation: "read" | "write" | "claim" | "open",
  path: string,
) {
  const host = resolveHostNamespace(req) || "unknown";
  return {
    host,
    namespace,
    operation,
    path,
    meTarget: `me://${namespace}:${operation}/${path || "_"}`,
  };
}

// Serve built GUI assets from this.GUI package dist
app.use("/gui", express.static(GUI_PKG_DIST_DIR));

// Bootstrap endpoint for GUI runtime (namespace + endpoint hints)
app.get("/__bootstrap", (req, res) => {
  const namespace = resolveNamespace(req);
  const host = resolveHostNamespace(req);
  const origin = `${req.protocol}://${host}`;
  const target = normalizeHttpRequestToMeTarget(req);
  return res.json(createEnvelope(target, {
    host,
    namespace,
    apiOrigin: origin,
    resolverHostName: NODE_HOSTNAME,
    resolverDisplayName: NODE_DISPLAY_NAME,
  }));
});

const resolveBridgeHandler = async (req: express.Request, res: express.Response) => {
  const rawTarget = String((req.query as any)?.target || "").trim();
  const decodedTarget = rawTarget ? decodeURIComponent(rawTarget) : "";
  const parsed = parseBridgeTarget(decodedTarget);
  const requestHost = resolveHostNamespace(req) || NODE_HOSTNAME || "localhost";

  if (!parsed) {
    return res.status(400).json({
      ok: false,
      operation: "read",
      target: buildBridgeTarget(null, requestHost, decodedTarget),
      error: "TARGET_REQUIRED",
    });
  }

  const bridgeTarget = buildBridgeTarget(parsed, requestHost, decodedTarget);

  if (!parsed.pathSlash) {
    return res.status(400).json({
      ok: false,
      operation: "read",
      target: bridgeTarget,
      error: "TARGET_PATH_REQUIRED",
    });
  }

  if (parsed.namespace.includes("[") || parsed.namespace.includes("]")) {
    return res.status(422).json({
      ok: false,
      operation: "read",
      target: bridgeTarget,
      error: "DEVICE_BINDING_UNRESOLVED",
      hint: "Namespace contains device binding; resolve via netget/runtime before HTTP.",
    });
  }

  if (parsed.pathSlash.startsWith("resolve")) {
    return res.status(400).json({
      ok: false,
      operation: "read",
      target: bridgeTarget,
      error: "RESOLVE_PATH_BLOCKED",
    });
  }

  try {
    const origin = `http://localhost:${PORT}`;
    const url = `${origin}/${parsed.pathSlash}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-forwarded-host": parsed.namespace,
        "x-forwarded-proto": "http",
        host: parsed.namespace,
      },
    });

    const contentType = String(response.headers.get("content-type") || "");
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      const patched = payload && typeof payload === "object"
        ? { ...payload, target: bridgeTarget }
        : { ok: response.ok, operation: "read", target: bridgeTarget, value: payload };
      return res.status(response.status).json(patched);
    }

    const text = await response.text();
    return res.status(response.status).send(text);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      operation: "read",
      target: bridgeTarget,
      error: "BRIDGE_FETCH_FAILED",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// --- Local Bridge: me:// -> http://localhost:<port>/resolve?target=...
// Allows browser testing of me:// targets without registering a protocol handler.
app.get("/resolve", resolveBridgeHandler);

// HTML shell for root and any deep route when Accept: text/html
app.get("/", (req, res, next) => {
  if ((req.query as any)?.target) {
    return resolveBridgeHandler(req, res);
  }
  if (!wantsHtml(req)) return next();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(htmlShell());
});
// Minimal request logger (no identity semantics, only transport info)
app.use((req, _res, next) => {
  const host = resolveHostNamespace(req);
  const lens = resolveLens(req);
  const target = normalizeHttpRequestToMeTarget(req);
  console.log(
    `→ ${req.method} ${req.url} host=${host || "unknown"} ns=${target.namespace} lens=${lens} op=${target.operation} me=${target.meTarget}`
  );
  next();
});

// --- Universal Ledger Write Surface ---------------------------------
// Accept ANY ME block (or arbitrary JSON) and append me to the ledger.
app.post("/", async (req: express.Request, res: express.Response) => {
  const body = req.body;
  const target = normalizeHttpRequestToMeTarget(req);
  const rawTarget = String((body as any)?.target || (req.query as any)?.target || "").trim();
  const parsedTarget = rawTarget ? parseBridgeTarget(rawTarget) : null;
  const operation = normalizeOperation((body as any)?.operation || (body as any)?.op || parsedTarget?.selector);
  const resolvedNamespace = String((body as any)?.namespace || parsedTarget?.namespace || resolveNamespace(req));

  if (!body || typeof body !== "object") {
    return res.status(400).json(createErrorEnvelope(target, {
      error: "Expected JSON block in request body",
    }));
  }

  if (operation === "claim") {
    const out = claimNamespace({
      namespace: resolvedNamespace,
      secret: String((body as any)?.secret || ""),
      publicKey: String((body as any)?.publicKey || "").trim() || null,
    });

    const claimTarget = buildNormalizedTarget(req, resolvedNamespace, "claim", "");
    if (!out.ok) {
      const status =
        out.error === "NAMESPACE_TAKEN"
          ? 409
          : out.error === "NAMESPACE_REQUIRED" || out.error === "SECRET_REQUIRED"
            ? 400
            : 500;
      return res.status(status).json(createErrorEnvelope(claimTarget, { error: out.error }));
    }

    return res.status(201).json(createEnvelope(claimTarget, {
      namespace: out.record.namespace,
      identityHash: out.record.identityHash,
      createdAt: out.record.createdAt,
    }));
  }

  if (operation === "open") {
    const out = openNamespace({
      namespace: resolvedNamespace,
      secret: String((body as any)?.secret || ""),
    });

    const openTarget = buildNormalizedTarget(req, resolvedNamespace, "open", "");
    if (!out.ok) {
      const status =
        out.error === "CLAIM_NOT_FOUND"
          ? 404
          : out.error === "CLAIM_VERIFICATION_FAILED"
            ? 403
            : out.error === "NAMESPACE_REQUIRED" || out.error === "SECRET_REQUIRED"
              ? 400
              : 500;
      return res.status(status).json(createErrorEnvelope(openTarget, { error: out.error }));
    }

    const memories = getMemoriesForNamespace(out.record.namespace);
    const openedAt = Date.now();
    const policy = getDefaultReadPolicy(out.record.namespace);
    const identity = parseNamespaceIdentity(out.record.namespace);
    const audit = {
      proofId: computeProofId({
        namespace: out.record.namespace,
        identityHash: out.record.identityHash,
        noise: out.noise,
        memories,
      }),
      openedAt,
    };

    return res.json(createEnvelope(openTarget, {
      verified: true,
      reasonCode: null,
      reason: null,
      identity,
      policy,
      audit,
      namespace: out.record.namespace,
      identityHash: out.record.identityHash,
      noise: out.noise,
      memories,
      openedAt,
    }));
  }

  const blockId = crypto.randomUUID();
  const timestamp = Date.now();
  const namespace = resolvedNamespace;
  const claim = getClaim(namespace);

  if (claim) {
    const authorized = isNamespaceWriteAuthorized({
      claimIdentityHash: claim.identityHash,
      claimPublicKey: claim.publicKey,
      body,
    });

    if (!authorized) {
      return res.status(403).json(createErrorEnvelope(target, {
        error: "NAMESPACE_WRITE_FORBIDDEN",
      }));
    }
  }

  const blockIdentityHash = claim
    ? claim.identityHash
    : String((body as any).identityHash || "").trim();

  const entry = await appendBlock({
    blockId,
    timestamp,
    namespace,
    identityHash: blockIdentityHash,
    expression: body.expression || "",
    json: body,
  });

  recordMemory({
    namespace,
    payload: body,
    identityHash: blockIdentityHash,
    timestamp,
  });

  console.log("🧱 New Ledger Block:");
  console.log(JSON.stringify(entry, null, 2));
  const writeTarget = buildNormalizedTarget(req, namespace, "write", "");
  return res.json(createEnvelope(writeTarget, {
    blockId,
    timestamp,
  }));
});

// --- Universal Ledger Read Surface ----------------------
app.get("/", async (req: express.Request, res: express.Response) => {
  const chainNs = resolveNamespace(req);
  const lens = resolveLens(req);
  const target = normalizeHttpRequestToMeTarget(req);
  const limit = Math.max(1, Math.min(5000, Number((req.query as any)?.limit ?? 5000)));
  const identityHash = String((req.query as any)?.identityHash || "").trim();

  const all = await getAllBlocks();
  const users = await getAllUsers();

  let blocks = filterBlocksByNamespace(all, chainNs);
  if (identityHash) {
    blocks = blocks.filter((b: any) => String(b?.identityHash || "") === identityHash);
  }

  // newest-first and limit
  blocks = blocks
    .slice()
    .sort((a: any, b: any) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0))
    .slice(0, limit);

  return res.json(createEnvelope(target, {
    namespace: chainNs,
    lens,
    users,
    blocks,
    count: blocks.length,
  }));
});

// Explicit blocks endpoint (same semantics as GET /, but clearer name)
app.get("/blocks", async (req: express.Request, res: express.Response) => {
  // Delegate by rewriting url semantics in place
  // (Keep implementation simple by copying the same logic.)
  const ns = resolveNamespace(req);
  const lens = resolveLens(req);
  const target = normalizeHttpRequestToMeTarget(req);
  const limit = Math.max(1, Math.min(5000, Number((req.query as any)?.limit ?? 5000)));
  const identityHash = String((req.query as any)?.identityHash || "").trim();

  const all = await getAllBlocks();
  let blocks = filterBlocksByNamespace(all, ns);
  if (identityHash) {
    blocks = blocks.filter((b: any) => String(b?.identityHash || "") === identityHash);
  }

  blocks = blocks
    .slice()
    .sort((a: any, b: any) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0))
    .slice(0, limit);

  return res.json(createEnvelope(target, {
    namespace: ns,
    lens,
    blocks,
    count: blocks.length,
  }));
});

// --- Convenience: allow GET /@... to behave like GET / but with path-based namespace addressing.
// NOTE: This MUST be defined before the catch-all path resolver.
app.get("/@*", async (req: express.Request, res: express.Response) => {
  const chainNs = resolveNamespace(req);
  const lens = resolveLens(req);
  const target = normalizeHttpRequestToMeTarget(req);
  const limit = Math.max(1, Math.min(5000, Number((req.query as any)?.limit ?? 5000)));
  const identityHash = String((req.query as any)?.identityHash || "").trim();

  const all = await getAllBlocks();

  let blocks = filterBlocksByNamespace(all, chainNs);
  if (identityHash) {
    blocks = blocks.filter((b: any) => String(b?.identityHash || "") === identityHash);
  }

  blocks = blocks
    .slice()
    .sort((a: any, b: any) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0))
    .slice(0, limit);

  return res.json(createEnvelope(target, {
    namespace: chainNs,
    lens,
    blocks,
    count: blocks.length,
  }));
});

// Legacy extensions: username claims and biometric matching remain available,
// but they are no longer presented as core cleaker semantics.

// --- CommitSync Protocol Endpoints ---
// Commit a new semantic memory event (single or batch)
app.post("/api/v1/commit", async (req, res) => {
  try {
    const { events } = req.body;
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: "No events provided" });
    }
    const results = [];
    for (const event of events) {
      // event: { namespace, path, operator, data, signature, expectedPrevHash, timestamp }
      try {
        const memory = require("./src/claim/memoryStore").appendSemanticMemory(event);
        results.push({ ok: true, memory });
      } catch (err) {
        results.push({ ok: false, error: String(err) });
      }
    }
    return res.json({ results });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// Sync: fetch semantic memory events for a namespace since a given timestamp/hash
app.get("/api/v1/sync", async (req, res) => {
  try {
    const namespace = String(req.query.namespace || "").trim().toLowerCase();
    const since = Number(req.query.since || 0);
    if (!namespace) {
      return res.status(400).json({ error: "Missing namespace" });
    }
    const all = require("./src/claim/memoryStore").listHostMemoryHistory;
    // For now, fetch all semantic memories for the namespace (future: optimize by timestamp/hash)
    // This demo assumes username and fingerprint are encoded in the namespace or query
    const username = String(req.query.username || "");
    const fingerprint = String(req.query.fingerprint || "");
    const limit = Number(req.query.limit || 2000);
    const events = all(username, fingerprint, limit).filter(
      (e: { timestamp?: number }) => Number(e?.timestamp ?? 0) > since,
    );
    return res.json({ events });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.use(createClaimsRouter());
app.use(createSessionRouter());
app.use(createLegacyRouter());


// --- Path Resolver Catch-all (MUST be last route before app.listen) ---
app.get("/*", (req, res, next) => {
  // If a browser is requesting HTML, always return the SPA shell.
  if (wantsHtml(req)) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(htmlShell());
  }
  return createPathResolverHandler()(req, res);
});
// --- Start Server ----------------------------------------
app.listen(PORT, () => {
  console.log(`\n🚀 Monad.ai daemon running at: http://localhost:${PORT}`);
  console.log("\n∴ Material Surface");
  console.log(`  - Ledger DB:      ${DB_PATH}`);
  console.log("  - Give thought:   POST /        (append JSON into current namespace)");
  console.log("  - Reach thought:  GET  /        (read current namespace surface)");
  console.log("  - Read blocks:    GET  /blocks  (explicit block stream view)");

  console.log("\n🔐 Claim Surface");
  console.log("  - Claim space:    POST /claims       (forge claim record + encrypted noise)");
  console.log("  - Open space:     POST /claims/open  (verify trinity -> recover noise)");

  console.log("\n🌐 Routing / Namespaces");
  console.log("  - Host header determines the chain namespace");
  console.log("  - Examples:");
  console.log("    • cleaker.me                 -> cleaker.me");
  console.log("    • username.cleaker.me        -> cleaker.me/users/username");
  console.log("    • username.localhost         -> localhost/users/username");
  console.log("    • cleaker.me/@username        -> cleaker.me/users/username (path-based)");
  console.log("    • localhost/@username         -> localhost/users/username (path-based)");
  console.log("    • cleaker.me/@a+b             -> cleaker.me/relations/a+b (symmetric relation)");
  console.log("    • cleaker.me/@a/@b            -> cleaker.me/users/a/users/b (directional nesting)");

  console.log("\n🔎 Namespace Reads");
  console.log("  - Resolve path:   GET  /<any/path>   e.g. /profile/displayName");
  console.log("    (Resolves within the chain namespace derived from host)");

  console.log("\n🕰 Legacy Extensions");
  console.log("  - Claim username: POST /users");
  console.log("  - Lookup user:    GET  /users/:username");
  console.log("  - Enroll face:    POST /faces/enroll");
  console.log("  - Match face:     POST /faces/match\n");
});
