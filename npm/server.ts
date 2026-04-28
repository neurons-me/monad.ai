import express from "express";
import cors from "cors";
import os from "os";
import path from "path";
import { getKernel, getKernelStateDir } from "./src/kernel/manager.js";
import { setupPersistence } from "./src/kernel/persist.js";
import { getAllBlocks } from "./src/Blockchain/blockchain.js";
import { getUsersForRootNamespace } from "./src/Blockchain/users.js";
import { claimNamespace, openNamespace, rebuildProjectedNamespaceClaims, getClaim } from "./src/claim/records.js";
import { ensureRootSemanticBootstrap } from "./src/claim/semanticBootstrap.js";
import { getMemoriesForNamespace, isNamespaceWriteAuthorized, recordMemory } from "./src/claim/replay.js";
import {
  appendSemanticMemory,
  listHostMemoryHistory,
  listSemanticMemoriesByNamespace,
  listSemanticMemoriesByRootNamespace,
} from "./src/claim/memoryStore.js";
import {
  filterBlocksByNamespace,
  formatObserverRelationLabel,
  resolveHostNamespace,
  resolveNamespace,
  resolveNamespaceProjectionRoot,
  resolveObserverRelation,
  resolveTransportHost,
} from "./src/http/namespace.js";
import { buildMeTargetNrp, normalizeHttpRequestToMeTarget } from "./src/http/meTarget.js";
import { createEnvelope, createErrorEnvelope } from "./src/http/envelope.js";
import { createPathResolverHandler } from "./src/http/pathResolver.js";
import { createClaimsRouter } from "./src/http/claims.js";
import { createSessionRouter } from "./src/http/session.js";
import { createLegacyRouter } from "./src/http/legacy.js";
import { loadSelfNodeConfig, resolveSelfDispatch } from "./src/http/selfMapping.js";
import { recordSurfaceRequest } from "./src/http/surfaceTelemetry.js";
import { normalizeNamespaceIdentity, normalizeNamespaceRootName } from "./src/namespace/identity.js";
import { GUI_PKG_DIST_DIR, htmlShell, wantsHtml } from "./src/http/shell.js";
import { computeProofId } from "./src/infra/hash.js";
import {
  parseBridgeTarget,
  buildBridgeTarget,
  buildNormalizedTarget,
  buildKernelCommandTarget,
  getNamespaceSelectorInfo,
} from "./src/runtime/bridge.js";
import {
  normalizeOperation,
  normalizeClaimableNamespace,
  isCanonicalClaimableNamespace,
  resolveCommandNamespace,
  getDefaultReadPolicy,
  parseNamespaceIdentity,
} from "./src/runtime/commands.js";
import {
  buildProviderBoot,
  createProviderSurface,
  type ProviderSurfaceConfig,
} from "./src/surfaces/providerSurface.js";
import { createFetchSurface } from "./src/surfaces/fetchSurface.js";

const PORT = process.env.PORT || 8161;
const NODE_HOSTNAME = os.hostname();
const NODE_DISPLAY_NAME = `${NODE_HOSTNAME}:${PORT}`;
const FETCH_PROXY_TIMEOUT_MS = Number(process.env.MONAD_FETCH_TIMEOUT_MS || 15000);
const ME_PKG_DIST_DIR = process.env.ME_PKG_DIST_DIR
  ? path.resolve(process.env.ME_PKG_DIST_DIR)
  : path.resolve(process.cwd(), "../../../this/.me/npm/dist");
const CLEAKER_PKG_DIST_DIR = process.env.CLEAKER_PKG_DIST_DIR
  ? path.resolve(process.env.CLEAKER_PKG_DIST_DIR)
  : path.resolve(process.cwd(), "../../cleaker/npm/dist");
const LOCAL_REACT_UMD_DIR = process.env.LOCAL_REACT_UMD_DIR
  ? path.resolve(process.env.LOCAL_REACT_UMD_DIR)
  : path.resolve(process.cwd(), "../../../this/GUI/npm/node_modules/react/umd");
const LOCAL_REACTDOM_UMD_DIR = process.env.LOCAL_REACTDOM_UMD_DIR
  ? path.resolve(process.env.LOCAL_REACTDOM_UMD_DIR)
  : path.resolve(process.cwd(), "../../../this/GUI/npm/node_modules/react-dom/umd");
const MONAD_ROUTES_PATH = process.env.MONAD_ROUTES_PATH
  ? path.resolve(process.env.MONAD_ROUTES_PATH)
  : path.resolve(process.cwd(), "../routes.js");
const SELF_NODE_CONFIG = loadSelfNodeConfig({
  cwd: process.cwd(),
  env: process.env,
  hostname: NODE_HOSTNAME,
  port: PORT,
});
const LOCAL_NAMESPACE_ROOT = normalizeNamespaceIdentity(
  SELF_NODE_CONFIG?.identity || process.env.ME_NAMESPACE || NODE_HOSTNAME,
);

const surfaceConfig: ProviderSurfaceConfig = {
  selfNodeConfig: SELF_NODE_CONFIG,
  hostname: NODE_HOSTNAME,
  displayName: NODE_DISPLAY_NAME,
};

function buildRequestProviderBoot(req: express.Request, namespace: string) {
  return buildProviderBoot(req, namespace, surfaceConfig);
}

const app = express();
app.set("trust proxy", true);
app.use(cors());
app.use(express.json());

const rebuiltProjectedClaims = rebuildProjectedNamespaceClaims();
if (rebuiltProjectedClaims > 0) {
  console.log(`↺ Rebuilt ${rebuiltProjectedClaims} projected user pointers into root namespaces`);
}
const semanticBootstrapRoot = normalizeNamespaceRootName(
  SELF_NODE_CONFIG?.identity || LOCAL_NAMESPACE_ROOT,
);
const seededSemanticBootstrap = ensureRootSemanticBootstrap(semanticBootstrapRoot);
if (seededSemanticBootstrap > 0) {
  console.log(`∷ Seeded ${seededSemanticBootstrap} root semantic memories in ${semanticBootstrapRoot}`);
}

function createNoCacheStaticOptions() {
  return {
    etag: false,
    lastModified: false,
    maxAge: 0,
    setHeaders(res: express.Response) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    },
  };
}

// Static assets
app.use("/gui", express.static(GUI_PKG_DIST_DIR, createNoCacheStaticOptions()));
app.use("/me", express.static(ME_PKG_DIST_DIR, createNoCacheStaticOptions()));
app.use("/cleaker", express.static(CLEAKER_PKG_DIST_DIR, createNoCacheStaticOptions()));
app.use("/vendor/react", express.static(LOCAL_REACT_UMD_DIR, createNoCacheStaticOptions()));
app.use("/vendor/react-dom", express.static(LOCAL_REACTDOM_UMD_DIR, createNoCacheStaticOptions()));
app.get("/routes.js", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res.sendFile(MONAD_ROUTES_PATH);
});

// Surface routers
app.use(createProviderSurface(surfaceConfig));
app.use(createFetchSurface({ timeoutMs: FETCH_PROXY_TIMEOUT_MS }));

// --- Bridge handler: me:// -> http://localhost:<port>/resolve?target=...
const resolveBridgeHandler = async (req: express.Request, res: express.Response) => {
  const rawTarget = String((req.query as any)?.target || "").trim();
  const decodedTarget = rawTarget ? decodeURIComponent(rawTarget) : "";
  const parsed = parseBridgeTarget(decodedTarget);
  const requestHost = resolveTransportHost(req) || NODE_HOSTNAME || "unknown-host";
  const relation = resolveObserverRelation(req);

  if (!parsed) {
    return res.status(400).json({
      ok: false,
      operation: "read",
      target: buildBridgeTarget(null, requestHost, relation, decodedTarget),
      error: "TARGET_REQUIRED",
    });
  }

  const bridgeTarget = buildBridgeTarget(parsed, requestHost, relation, decodedTarget);
  let selectorDispatch: ReturnType<typeof resolveSelfDispatch> | null = null;

  if (!parsed.pathSlash) {
    return res.status(400).json({
      ok: false,
      operation: "read",
      target: bridgeTarget,
      error: "TARGET_PATH_REQUIRED",
    });
  }

  if (parsed.namespace.includes("[") || parsed.namespace.includes("]")) {
    const selectorInfo = getNamespaceSelectorInfo(parsed.namespace);
    const dispatch = resolveSelfDispatch(selectorInfo.base, selectorInfo.selectorRaw, SELF_NODE_CONFIG);
    selectorDispatch = dispatch;

    if (dispatch.mode === "local") {
      parsed.namespace = selectorInfo.base;
    }

    if (dispatch.mode !== "local" && selectorInfo.webTarget) {
      const webTarget = {
        host: requestHost,
        namespace: parsed.namespace,
        operation: "read" as const,
        path: parsed.pathDot || "",
        nrp: buildMeTargetNrp(parsed.namespace, "read", parsed.pathDot || "", relation),
        relation,
      };
      try {
        const response = await fetch(selectorInfo.webTarget, { method: "GET" });
        const contentType = String(response.headers.get("content-type") || "text/html; charset=utf-8");
        const wantsJson = String(req.headers.accept || "").includes("application/json");
        const bodyText = await response.text();

        if (!wantsJson) {
          res.setHeader("Content-Type", contentType);
          return res.status(response.status).send(bodyText);
        }

        return res.status(response.status).json({
          ...createEnvelope(webTarget, {
            value: {
              url: selectorInfo.webTarget,
              status: response.status,
              contentType,
              body: bodyText,
              overlay: parsed.pathDot || "",
            },
          }),
          dispatch,
        });
      } catch (error) {
        return res.status(502).json({
          ...createErrorEnvelope(webTarget, {
            error: "WEB_FETCH_FAILED",
            detail: error instanceof Error ? error.message : String(error),
          }),
          dispatch,
        });
      }
    }

    if (dispatch.hasInstanceSelector) {
      return res.status(422).json({
        ok: false,
        operation: "read",
        target: bridgeTarget,
        dispatch,
        error: "INSTANCE_SELECTOR_UNRESOLVED",
        hint: "Selector targets the same identity, but this node is not the requested instance.",
      });
    }

    if (selectorInfo.selectorRaw) {
      return res.status(422).json({
        ok: false,
        operation: "read",
        target: bridgeTarget,
        dispatch,
        error: "SELECTOR_BINDING_UNRESOLVED",
        hint: "Namespace selector requires an instance or transport resolver before HTTP dispatch.",
      });
    }
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
    const url = new URL(`/${parsed.pathSlash}`, origin);
    for (const [key, value] of Object.entries(req.query || {})) {
      if (key === "target") continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
        continue;
      }
      if (typeof value !== "undefined") url.searchParams.set(key, String(value));
    }

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
        ? { ...payload, target: bridgeTarget, ...(selectorDispatch ? { dispatch: selectorDispatch } : {}) }
        : { ok: response.ok, operation: "read", target: bridgeTarget, value: payload, ...(selectorDispatch ? { dispatch: selectorDispatch } : {}) };
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

app.get("/resolve", resolveBridgeHandler);

app.post("/me/*", async (req: express.Request, res: express.Response) => {
  const rawTarget = decodeURIComponent(String((req.params as any)[0] || "").trim());
  const parsedTarget = parseBridgeTarget(rawTarget.startsWith("me://") ? rawTarget : `me://${rawTarget}`);

  if (!parsedTarget) {
    const target = buildKernelCommandTarget(req, "claim", "");
    return res.status(400).json(createErrorEnvelope(target, {
      error: "TARGET_REQUIRED",
      detail: "Expected a me target after /me/.",
    }));
  }

  if (parsedTarget.namespace !== "kernel" || (parsedTarget.selector !== "claim" && parsedTarget.selector !== "open")) {
    const target = buildKernelCommandTarget(
      req,
      parsedTarget.selector === "open" ? "open" : "claim",
      parsedTarget.pathSlash || parsedTarget.pathDot,
    );
    return res.status(501).json(createErrorEnvelope(target, {
      error: "KERNEL_COMMAND_UNSUPPORTED",
      detail: "Only kernel claim/open commands are implemented on /me/* for now.",
    }));
  }

  const operation = parsedTarget.selector as "claim" | "open";
  const body = (req.body ?? {}) as Record<string, unknown>;
  const namespace = normalizeClaimableNamespace(body.namespace || parsedTarget.pathSlash || parsedTarget.pathDot);
  const target = buildKernelCommandTarget(req, operation, namespace);

  if (!namespace) {
    return res.status(400).json(createErrorEnvelope(target, { error: "NAMESPACE_REQUIRED" }));
  }

  if (!isCanonicalClaimableNamespace(namespace)) {
    return res.status(400).json(createErrorEnvelope(target, {
      error: "FULL_NAMESPACE_REQUIRED",
      detail: "Public claims should use a full namespace such as username.cleaker.me.",
    }));
  }

  if (operation === "claim") {
    const out = await claimNamespace({
      namespace,
      secret: String(body.secret || ""),
      identityHash: String(body.identityHash || "").trim(),
      publicKey: String(body.publicKey || "").trim() || null,
      privateKey: String(body.privateKey || "").trim() || null,
      proof: (body.proof && typeof body.proof === "object") ? body.proof as any : null,
    });

    if (!out.ok) {
      const status =
        out.error === "NAMESPACE_TAKEN" ? 409
        : out.error === "NAMESPACE_REQUIRED" || out.error === "SECRET_REQUIRED"
          || out.error === "IDENTITY_HASH_REQUIRED" || out.error === "CLAIM_KEY_INVALID"
          || out.error === "CLAIM_KEYPAIR_MISMATCH" || out.error === "PROOF_MESSAGE_INVALID"
          || out.error === "PROOF_NAMESPACE_MISMATCH" || out.error === "PROOF_TIMESTAMP_INVALID" ? 400
        : out.error === "PROOF_INVALID" ? 403
        : 500;
      return res.status(status).json(createErrorEnvelope(target, { error: out.error }));
    }

    return res.status(201).json(createEnvelope(target, {
      namespace: out.record.namespace,
      identityHash: out.record.identityHash,
      publicKey: out.record.publicKey,
      createdAt: out.record.createdAt,
      persistentClaim: out.persistentClaim,
    }));
  }

  const out = openNamespace({
    namespace,
    secret: String(body.secret || ""),
    identityHash: String(body.identityHash || "").trim(),
  });

  if (!out.ok) {
    const status =
      out.error === "CLAIM_NOT_FOUND" ? 404
      : out.error === "CLAIM_VERIFICATION_FAILED" || out.error === "IDENTITY_MISMATCH" ? 403
      : out.error === "NAMESPACE_REQUIRED" || out.error === "SECRET_REQUIRED"
        || out.error === "IDENTITY_HASH_REQUIRED" ? 400
      : 500;
    return res.status(status).json(createErrorEnvelope(target, { error: out.error }));
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

  return res.json(createEnvelope(target, {
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
});

// HTML shell for root when Accept: text/html
app.get("/", (req, res, next) => {
  if ((req.query as any)?.target) return resolveBridgeHandler(req, res);
  if (!wantsHtml(req)) return next();
  const namespace = resolveNamespace(req);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(htmlShell({ providerBoot: buildRequestProviderBoot(req, namespace) }));
});

// Minimal request logger
app.use((req, _res, next) => {
  const transportHost = resolveTransportHost(req);
  const forwardedHost = resolveHostNamespace(req);
  const target = normalizeHttpRequestToMeTarget(req);
  const lens = formatObserverRelationLabel(target.relation);
  const startedAt = Date.now();
  const forwardedSuffix = forwardedHost && forwardedHost !== transportHost ? ` xf=${forwardedHost}` : "";
  console.log(`→ ${req.method} ${req.url} host=${transportHost || "unknown"} ns=${target.namespace} lens=${lens} op=${target.operation} nrp=${target.nrp}${forwardedSuffix}`);
  _res.on("finish", () => {
    if (req.path === "/__surface/events") return;
    recordSurfaceRequest({
      method: req.method,
      url: req.url,
      status: _res.statusCode,
      durationMs: Date.now() - startedAt,
      host: transportHost || "unknown",
      namespace: target.namespace,
      operation: target.operation,
      nrp: target.nrp,
      lens,
      forwardedHost: forwardedHost && forwardedHost !== transportHost ? forwardedHost : null,
      timestamp: startedAt,
    });
  });
  next();
});

// --- Universal Ledger Write Surface
app.post("/", async (req: express.Request, res: express.Response) => {
  const body = req.body;
  const target = normalizeHttpRequestToMeTarget(req);
  const rawTarget = String((body as any)?.target || (req.query as any)?.target || "").trim();
  const parsedTarget = rawTarget ? parseBridgeTarget(rawTarget) : null;
  const operation = normalizeOperation((body as any)?.operation || (body as any)?.op || parsedTarget?.selector);
  const resolvedNamespace = resolveCommandNamespace(
    operation,
    (body ?? {}) as Record<string, unknown>,
    parsedTarget,
    resolveNamespace(req),
  );
  const commandTarget =
    (operation === "claim" || operation === "open") && parsedTarget?.namespace === "kernel"
      ? buildKernelCommandTarget(req, operation, resolvedNamespace)
      : null;

  if (!body || typeof body !== "object") {
    return res.status(400).json(createErrorEnvelope(target, { error: "Expected JSON block in request body" }));
  }

  if (operation === "claim") {
    if (commandTarget && !isCanonicalClaimableNamespace(resolvedNamespace)) {
      return res.status(400).json(createErrorEnvelope(commandTarget, {
        error: "FULL_NAMESPACE_REQUIRED",
        detail: "Public claims should use a full namespace such as username.cleaker.me.",
      }));
    }

    const out = await claimNamespace({
      namespace: resolvedNamespace,
      secret: String((body as any)?.secret || ""),
      identityHash: String((body as any)?.identityHash || "").trim(),
      publicKey: String((body as any)?.publicKey || "").trim() || null,
      privateKey: String((body as any)?.privateKey || "").trim() || null,
      proof: ((body as any)?.proof && typeof (body as any).proof === "object") ? (body as any).proof : null,
    });

    const claimTarget = commandTarget || buildNormalizedTarget(req, resolvedNamespace, "claim", "");
    if (!out.ok) {
      const status =
        out.error === "NAMESPACE_TAKEN" ? 409
        : out.error === "NAMESPACE_REQUIRED" || out.error === "SECRET_REQUIRED"
          || out.error === "IDENTITY_HASH_REQUIRED" || out.error === "CLAIM_KEY_INVALID"
          || out.error === "CLAIM_KEYPAIR_MISMATCH" || out.error === "PROOF_MESSAGE_INVALID"
          || out.error === "PROOF_NAMESPACE_MISMATCH" || out.error === "PROOF_TIMESTAMP_INVALID" ? 400
        : out.error === "PROOF_INVALID" ? 403
        : 500;
      return res.status(status).json(createErrorEnvelope(claimTarget, { error: out.error }));
    }

    return res.status(201).json(createEnvelope(claimTarget, {
      namespace: out.record.namespace,
      identityHash: out.record.identityHash,
      publicKey: out.record.publicKey,
      createdAt: out.record.createdAt,
      persistentClaim: out.persistentClaim,
    }));
  }

  if (operation === "open") {
    if (commandTarget && !isCanonicalClaimableNamespace(resolvedNamespace)) {
      return res.status(400).json(createErrorEnvelope(commandTarget, {
        error: "FULL_NAMESPACE_REQUIRED",
        detail: "Public opens should use a full namespace such as username.cleaker.me.",
      }));
    }

    const out = openNamespace({
      namespace: resolvedNamespace,
      secret: String((body as any)?.secret || ""),
      identityHash: String((body as any)?.identityHash || "").trim(),
    });

    const openTarget = commandTarget || buildNormalizedTarget(req, resolvedNamespace, "open", "");
    if (!out.ok) {
      const status =
        out.error === "CLAIM_NOT_FOUND" ? 404
        : out.error === "CLAIM_VERIFICATION_FAILED" || out.error === "IDENTITY_MISMATCH" ? 403
        : out.error === "NAMESPACE_REQUIRED" || out.error === "SECRET_REQUIRED"
          || out.error === "IDENTITY_HASH_REQUIRED" ? 400
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
      return res.status(403).json(createErrorEnvelope(target, { error: "NAMESPACE_WRITE_FORBIDDEN" }));
    }
  }

  const blockIdentityHash = claim
    ? claim.identityHash
    : String((body as any).identityHash || "").trim();

  const entry = recordMemory({ namespace, payload: body, identityHash: blockIdentityHash, timestamp });
  if (!entry) {
    return res.status(400).json(createErrorEnvelope(target, { error: "INVALID_MEMORY_INPUT" }));
  }

  console.log("🧠 New Memory Event:");
  console.log(JSON.stringify(entry, null, 2));
  const writeTarget = buildNormalizedTarget(req, namespace, "write", "");
  return res.json(createEnvelope(writeTarget, {
    memoryHash: entry?.hash || null,
    prevMemoryHash: entry?.prevHash || null,
    namespace,
    path: entry?.path || String((body as any).expression || "").trim(),
    operator: entry?.operator ?? null,
    timestamp: entry?.timestamp || timestamp,
  }));
});

// --- Universal Ledger Read Surface
app.get("/", (req: express.Request, res: express.Response) => {
  const chainNs = resolveNamespace(req);
  const target = normalizeHttpRequestToMeTarget(req);
  const lens = formatObserverRelationLabel(target.relation);
  const limit = Math.max(1, Math.min(5000, Number((req.query as any)?.limit ?? 5000)));
  const identityHash = String((req.query as any)?.identityHash || "").trim();
  const rootNamespace = resolveNamespaceProjectionRoot(chainNs) || chainNs;

  const all = getAllBlocks();
  const users = getUsersForRootNamespace(rootNamespace);

  let blocks = filterBlocksByNamespace(all, chainNs);
  if (identityHash) blocks = blocks.filter((b: any) => String(b?.authorIdentityHash || "") === identityHash);

  blocks = blocks.slice().sort((a: any, b: any) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0)).slice(0, limit);

  return res.json(createEnvelope(target, { namespace: chainNs, rootNamespace, lens, users, blocks, count: blocks.length }));
});

app.get("/blocks", (req: express.Request, res: express.Response) => {
  const ns = resolveNamespace(req);
  const target = normalizeHttpRequestToMeTarget(req);
  const lens = formatObserverRelationLabel(target.relation);
  const limit = Math.max(1, Math.min(5000, Number((req.query as any)?.limit ?? 5000)));
  const identityHash = String((req.query as any)?.identityHash || "").trim();

  const all = getAllBlocks();
  let blocks = filterBlocksByNamespace(all, ns);
  if (identityHash) blocks = blocks.filter((b: any) => String(b?.authorIdentityHash || "") === identityHash);

  blocks = blocks.slice().sort((a: any, b: any) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0)).slice(0, limit);

  return res.json(createEnvelope(target, { namespace: ns, lens, blocks, count: blocks.length }));
});

app.get("/blockchain", async (req: express.Request, res: express.Response) => {
  const chainNs = resolveNamespace(req);
  const rootNamespace = resolveNamespaceProjectionRoot(chainNs) || chainNs;
  const target = normalizeHttpRequestToMeTarget(req);
  const lens = formatObserverRelationLabel(target.relation);
  const limit = Math.max(1, Math.min(5000, Number((req.query as any)?.limit ?? 500)));
  const memories = listSemanticMemoriesByRootNamespace(rootNamespace, { limit });
  return res.json(createEnvelope(target, { namespace: chainNs, rootNamespace, lens, memories, count: memories.length }));
});

// NOTE: Must be defined before the catch-all path resolver.
app.get("/@*", (req: express.Request, res: express.Response) => {
  const chainNs = resolveNamespace(req);
  const target = normalizeHttpRequestToMeTarget(req);
  const lens = formatObserverRelationLabel(target.relation);
  const limit = Math.max(1, Math.min(5000, Number((req.query as any)?.limit ?? 5000)));
  const identityHash = String((req.query as any)?.identityHash || "").trim();

  const all = getAllBlocks();
  let blocks = filterBlocksByNamespace(all, chainNs);
  if (identityHash) blocks = blocks.filter((b: any) => String(b?.authorIdentityHash || "") === identityHash);
  blocks = blocks.slice().sort((a: any, b: any) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0)).slice(0, limit);

  return res.json(createEnvelope(target, { namespace: chainNs, lens, blocks, count: blocks.length }));
});

// --- CommitSync Protocol
app.post("/api/v1/commit", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawEvents = Array.isArray(body.events)
      ? body.events
      : body.memory && typeof body.memory === "object"
        ? [{
            namespace: body.namespace,
            ...(body.memory as Record<string, unknown>),
            data: Object.prototype.hasOwnProperty.call(body.memory as Record<string, unknown>, "data")
              ? (body.memory as Record<string, unknown>).data
              : (body.memory as Record<string, unknown>).value,
          }]
        : [];
    if (!rawEvents.length) return res.status(400).json({ error: "No events provided" });
    const results = [];
    for (const event of rawEvents) {
      try {
        const memory = appendSemanticMemory(event);
        results.push({ ok: true, memory });
      } catch (err) {
        results.push({ ok: false, error: String(err) });
      }
    }
    const first = results[0] && (results[0] as { ok: boolean; memory?: { hash?: string } });
    return res.status(201).json({
      ok: results.every((entry) => Boolean((entry as { ok?: boolean }).ok)),
      hash: first?.memory?.hash || null,
      results,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.get("/api/v1/sync", async (req, res) => {
  try {
    const namespace = String(req.query.namespace || "").trim().toLowerCase();
    const since = Number(req.query.since || 0);
    if (!namespace) return res.status(400).json({ error: "Missing namespace" });
    const username = String(req.query.username || "");
    const fingerprint = String(req.query.fingerprint || "");
    const limit = Number(req.query.limit || 2000);
    const events = (username && fingerprint
      ? listHostMemoryHistory(namespace, username, fingerprint, limit)
      : listSemanticMemoriesByNamespace(namespace, { limit })
    ).filter((e: { timestamp?: number }) => Number(e?.timestamp ?? 0) > since);
    return res.json({ events, memories: events });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.use(createClaimsRouter());
app.use(createSessionRouter());
app.use(createLegacyRouter());

// --- Path Resolver Catch-all (MUST be last route before app.listen)
app.get("/*", (req, res) => {
  if (wantsHtml(req)) {
    const namespace = resolveNamespace(req);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(htmlShell({ providerBoot: buildRequestProviderBoot(req, namespace) }));
  }
  return createPathResolverHandler()(req, res);
});

// --- Start Server
getKernel();
setupPersistence();

if (!process.env.JEST_WORKER_ID) {
  app.listen(PORT, () => {
    console.log(`\n🚀 Monad.ai daemon running at: http://localhost:${PORT}`);
    console.log("\n∴ Material Surface");
    console.log(`  - State Dir:      ${getKernelStateDir()}`);
    console.log("  - Give thought:   POST /        (append JSON into current namespace)");
    console.log("  - Reach thought:  GET  /        (read current namespace surface)");
    console.log("  - Read blocks:    GET  /blocks  (explicit block stream view)");
    console.log("  - Provider boot:  GET  /__provider");
    console.log("  - Provider read:  GET  /__provider/resolve?path=profile/name");
    console.log("  - Provider GUI:   GET  /__provider/surface?route=/");

    console.log("\n🔐 Claim Surface");
    console.log("  - Claim space:    POST /claims       (forge claim record + encrypted noise)");
    console.log("  - Open space:     POST /claims/open  (verify trinity -> recover noise)");
    console.log("  - Kernel claim:   POST /me/kernel:claim/<full-namespace>");
    console.log("  - Kernel open:    POST /me/kernel:open/<full-namespace>");

    console.log("\n🌐 Routing / Namespaces");
    console.log("  - Host header determines the chain namespace");
    console.log("  - Examples:");
    console.log("    • cleaker.me                  -> cleaker.me");
    console.log("    • username.cleaker.me         -> username.cleaker.me");
    console.log(`    • localhost (loopback alias)  -> ${LOCAL_NAMESPACE_ROOT}`);
    console.log(`    • username.localhost          -> username.${LOCAL_NAMESPACE_ROOT} (loopback alias projection)`);
    console.log("    • cleaker.me/@username        -> username.cleaker.me (path projection)");
    console.log(`    • localhost/@username         -> username.${LOCAL_NAMESPACE_ROOT} (loopback alias projection)`);
    console.log("    • cleaker.me/@a+b             -> cleaker.me (relation stays semantic, no DNS projection)");
    console.log("    • cleaker.me/@a/@b            -> a.cleaker.me (target projects, relation stays semantic)");
    console.log("    • ana.cleaker.me/profile?as=bella -> target=ana.cleaker.me, observer=bella.cleaker.me");
    if (SELF_NODE_CONFIG) {
      console.log("    • me://ana.cleaker.me[macbook]:read/profile -> local if selector matches this node tags");
    }

    if (SELF_NODE_CONFIG) {
      console.log("\n🪞 Self Mapping");
      console.log(`  - Identity:       ${SELF_NODE_CONFIG.identity}`);
      console.log(`  - Tags:           ${SELF_NODE_CONFIG.tags.join(", ") || "(none)"}`);
      console.log(`  - Endpoint:       ${SELF_NODE_CONFIG.endpoint}`);
      console.log(`  - Config Path:    ${SELF_NODE_CONFIG.configPath}`);
    }

    console.log("\n🔎 Namespace Reads");
    console.log("  - Resolve path:   GET  /<any/path>   e.g. /profile/displayName");
    console.log("    (Resolves within the chain namespace derived from host)");

    console.log("\n🕰 Legacy Extensions");
    console.log("  - Claim username: POST /users");
    console.log("  - Lookup user:    GET  /users/:username\n");
  });
}

export default app;
