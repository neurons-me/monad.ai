import express from "express";
import cors from "cors";
import os from "os";
import { createHash } from "crypto";
import { db, DB_PATH } from "./src/Blockchain/db";
import { appendBlock, getAllBlocks } from "./src/Blockchain/blockchain";
import { getUsersForRootNamespace } from "./src/Blockchain/users";
import { claimNamespace, openNamespace, rebuildProjectedNamespaceClaims } from "./src/claim/records";
import { ensureRootSemanticBootstrap } from "./src/claim/semanticBootstrap";
import { getMemoriesForNamespace } from "./src/claim/replay";
import { getClaim } from "./src/claim/records";
import { isNamespaceWriteAuthorized, recordMemory } from "./src/claim/replay";
import { listSemanticMemoriesByRootNamespace } from "./src/claim/memoryStore";
import {
  filterBlocksByNamespace,
  formatObserverRelationLabel,
  resolveHostNamespace,
  resolveNamespace,
  resolveNamespaceProjectionRoot,
  resolveObserverRelation,
  resolveTransportHost,
  type ObserverRelation,
} from "./src/http/namespace";
import { buildMeTargetNrp, normalizeHttpRequestToMeTarget } from "./src/http/meTarget";
import { createEnvelope, createErrorEnvelope } from "./src/http/envelope";
import { createPathResolverHandler } from "./src/http/pathResolver";
import { createClaimsRouter } from "./src/http/claims";
import { createSessionRouter } from "./src/http/session";
import { createLegacyRouter } from "./src/http/legacy";
import {
  buildSelfSurfaceEntry,
  loadSelfNodeConfig,
  resolveSelfDispatch,
} from "./src/http/selfMapping";
import {
  normalizeNamespaceIdentity,
  normalizeNamespaceRootName,
  parseNamespaceIdentityParts,
} from "./src/namespace/identity";
import { parseTarget } from "cleaker";
import { GUI_PKG_DIST_DIR, htmlShell, wantsHtml } from "./src/http/shell";

const PORT = process.env.PORT || 8161;
const NODE_HOSTNAME = os.hostname();
const NODE_DISPLAY_NAME = `${NODE_HOSTNAME}:${PORT}`;
const FETCH_PROXY_TIMEOUT_MS = Number(process.env.MONAD_FETCH_TIMEOUT_MS || 15000);
const LOCAL_NAMESPACE_ROOT = normalizeNamespaceIdentity("localhost");
const SELF_NODE_CONFIG = loadSelfNodeConfig({
  cwd: process.cwd(),
  env: process.env,
  hostname: NODE_HOSTNAME,
  port: PORT,
});
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

type BridgeTarget = {
  namespace: string;
  selector: string;
  pathSlash: string;
  pathDot: string;
  nrp: string;
};

type ClaimIdentity = {
  host: string;
  username: string;
  effective: string;
};

type NamespaceSelectorInfo = {
  base: string;
  selectorRaw: string | null;
  webTarget: string | null;
  hasDevice: boolean;
};

const RESERVED_SHORT_NAMESPACES = new Set(["self", "kernel", "local"]);

function extractNamespaceSelector(namespace: string): { base: string; selectorRaw: string | null } {
  const raw = String(namespace || "").trim();
  if (!raw) return { base: "", selectorRaw: null };
  const match = raw.match(/^([^\[]+)(?:\[(.*)\])?$/);
  if (!match) return { base: raw, selectorRaw: null };
  return {
    base: String(match[1] || "").trim(),
    selectorRaw: match[2] === undefined ? null : String(match[2] || "").trim(),
  };
}

function findSelectorValue(selectorRaw: string, selectorType: string): string | null {
  const type = String(selectorType || "").trim().toLowerCase();
  if (!type) return null;
  const groups = selectorRaw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const group of groups) {
    const parts = group
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    for (const part of parts) {
      const colon = part.indexOf(":");
      if (colon < 0) continue;
      const head = part.slice(0, colon).trim().toLowerCase();
      if (!head || head !== type) continue;
      const rest = part.slice(colon + 1).trim();
      if (!rest) continue;
      const value = rest.split(",")[0]?.trim();
      if (value) return value;
    }
  }
  return null;
}

function normalizeWebUrl(value: string): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw.replace(/^\/+/, "")}`;
}

function parseHttpFetchUrl(value: unknown): URL | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

function getNamespaceSelectorInfo(namespace: string): NamespaceSelectorInfo {
  const { base, selectorRaw } = extractNamespaceSelector(namespace);
  if (!selectorRaw) {
    return {
      base,
      selectorRaw: null,
      webTarget: null,
      hasDevice: false,
    };
  }

  const webValue = findSelectorValue(selectorRaw, "web");
  const webTarget = webValue ? normalizeWebUrl(webValue) : null;
  const deviceValue = findSelectorValue(selectorRaw, "device");
  const hostValue = findSelectorValue(selectorRaw, "host");
  const hasDevice = !!(deviceValue || hostValue);

  return {
    base,
    selectorRaw,
    webTarget,
    hasDevice,
  };
}

function parseBridgeTarget(rawInput: string): BridgeTarget | null {
  const raw = String(rawInput || "").trim();
  if (!raw) return null;
  try {
    const parsed = parseTarget(raw.startsWith("me://") ? raw : `me://${raw}`, { allowShorthandRead: true });
    const namespace = normalizeNamespaceIdentity(parsed.namespace.fqdn);
    if (!namespace) return null;

    const selector = String(parsed.operation || parsed.intent.selector || "read").trim() || "read";
    const pathSlash = String(parsed.path || "").trim().replace(/^\/+/, "");
    const pathDot = pathSlash
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean)
      .join(".");
    const nrp = `me://${namespace}:${selector}/${pathDot || "_"}`;

    return {
      namespace,
      selector,
      pathSlash,
      pathDot,
      nrp,
    };
  } catch {
    return null;
  }
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
  return parseNamespaceIdentityParts(namespace);
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

function normalizeClaimableNamespace(raw: unknown): string {
  return normalizeNamespaceIdentity(raw);
}

function isCanonicalClaimableNamespace(namespace: string): boolean {
  const ns = normalizeClaimableNamespace(namespace);
  if (!ns) return false;
  if (RESERVED_SHORT_NAMESPACES.has(ns)) return true;
  return ns.includes(".");
}

function buildKernelCommandTarget(
  req: express.Request,
  operation: "claim" | "open",
  path: string,
) {
  const host = resolveTransportHost(req) || "unknown";
  const normalizedPath = String(path || "").trim();
  const relation = resolveObserverRelation(req);
  return {
    host,
    namespace: "kernel",
    operation,
    path: normalizedPath || "_",
    nrp: buildMeTargetNrp("kernel", operation, normalizedPath || "_", relation),
    relation,
  };
}

function resolveCommandNamespace(
  operation: "read" | "write" | "claim" | "open",
  body: Record<string, unknown>,
  parsedTarget: BridgeTarget | null,
  fallbackNamespace: string,
): string {
  const bodyNamespace = normalizeClaimableNamespace(body.namespace);
  if (bodyNamespace) return bodyNamespace;
  if ((operation === "claim" || operation === "open") && parsedTarget?.namespace === "kernel") {
    const commandPath = normalizeClaimableNamespace(parsedTarget.pathSlash || parsedTarget.pathDot);
    if (commandPath) return commandPath;
  }
  return normalizeClaimableNamespace(parsedTarget?.namespace || fallbackNamespace);
}

function buildBridgeTarget(
  resolved: BridgeTarget | null,
  requestHost: string,
  relation: ObserverRelation,
  rawFallback = "",
) {
  const namespaceMe = resolved?.namespace || "unknown";
  const nrp = resolved
    ? buildMeTargetNrp(namespaceMe, "read", resolved.pathDot || "", relation)
    : rawFallback || buildMeTargetNrp(namespaceMe, "read", "", relation);
  return {
    namespace: {
      me: namespaceMe,
      host: requestHost,
    },
    operation: "read" as const,
    path: resolved?.pathDot || "",
    nrp,
    relation,
  };
}

function buildNormalizedTarget(
  req: express.Request,
  namespace: string,
  operation: "read" | "write" | "claim" | "open",
  path: string,
) {
  const host = resolveTransportHost(req) || "unknown";
  const relation = resolveObserverRelation(req);
  return {
    host,
    namespace,
    operation,
    path,
    nrp: buildMeTargetNrp(namespace, operation, path, relation),
    relation,
  };
}

// Serve built GUI assets from this.GUI package dist
app.use("/gui", express.static(GUI_PKG_DIST_DIR));

// Bootstrap endpoint for GUI runtime (namespace + endpoint hints)
app.get("/__bootstrap", (req, res) => {
  const namespace = resolveNamespace(req);
  const host = resolveTransportHost(req);
  const hostHeader = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host || host;
  const origin = `${req.protocol}://${String(hostHeader || host).trim()}`;
  const target = normalizeHttpRequestToMeTarget(req);
  const surfaceEntry = buildSelfSurfaceEntry({
    self: SELF_NODE_CONFIG,
    origin,
    fallbackHost: NODE_HOSTNAME,
    requestNamespace: namespace,
  });
  return res.json(createEnvelope(target, {
    host,
    namespace,
    apiOrigin: origin,
    resolverHostName: NODE_HOSTNAME,
    resolverDisplayName: NODE_DISPLAY_NAME,
    surfaceEntry,
  }));
});

app.get("/__fetch", async (req, res) => {
  const target = normalizeHttpRequestToMeTarget(req);
  const remoteUrl = parseHttpFetchUrl((req.query as any)?.url);

  if (!remoteUrl) {
    return res.status(400).json(createErrorEnvelope(target, {
      error: "FETCH_URL_INVALID",
      detail: "Provide an absolute http(s) URL via ?url=",
    }));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_PROXY_TIMEOUT_MS);

  try {
    const response = await fetch(remoteUrl.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": "monad.ai/1.0 this.DOM fetch proxy",
      },
    });

    const contentType = String(response.headers.get("content-type") || "text/html; charset=utf-8");
    const bodyText = await response.text();

    return res.status(response.status).json(createEnvelope(target, {
      value: {
        url: remoteUrl.toString(),
        finalUrl: response.url || remoteUrl.toString(),
        status: response.status,
        ok: response.ok,
        contentType,
        body: bodyText,
      },
    }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const isTimeout = error instanceof Error && error.name === "AbortError";
    return res.status(isTimeout ? 504 : 502).json(createErrorEnvelope(target, {
      error: isTimeout ? "FETCH_TIMEOUT" : "FETCH_PROXY_FAILED",
      detail,
      value: {
        url: remoteUrl.toString(),
      },
    }));
  } finally {
    clearTimeout(timeoutId);
  }
});

const resolveBridgeHandler = async (req: express.Request, res: express.Response) => {
  const rawTarget = String((req.query as any)?.target || "").trim();
  const decodedTarget = rawTarget ? decodeURIComponent(rawTarget) : "";
  const parsed = parseBridgeTarget(decodedTarget);
  const requestHost = resolveTransportHost(req) || NODE_HOSTNAME || "localhost";
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
        for (const item of value) {
          url.searchParams.append(key, String(item));
        }
        continue;
      }
      if (typeof value !== "undefined") {
        url.searchParams.set(key, String(value));
      }
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
        ? {
            ...payload,
            target: bridgeTarget,
            ...(selectorDispatch ? { dispatch: selectorDispatch } : {}),
          }
        : {
            ok: response.ok,
            operation: "read",
            target: bridgeTarget,
            value: payload,
            ...(selectorDispatch ? { dispatch: selectorDispatch } : {}),
          };
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
    return res.status(400).json(createErrorEnvelope(target, {
      error: "NAMESPACE_REQUIRED",
    }));
  }

  if (!isCanonicalClaimableNamespace(namespace)) {
    return res.status(400).json(createErrorEnvelope(target, {
      error: "FULL_NAMESPACE_REQUIRED",
      detail: "Public claims should use a full namespace such as username.cleaker.me.",
    }));
  }

  if (operation === "claim") {
    const out = claimNamespace({
      namespace,
      secret: String(body.secret || ""),
      publicKey: String(body.publicKey || "").trim() || null,
      privateKey: String(body.privateKey || "").trim() || null,
    });

    if (!out.ok) {
      const status =
        out.error === "NAMESPACE_TAKEN"
          ? 409
          : out.error === "NAMESPACE_REQUIRED"
              || out.error === "SECRET_REQUIRED"
              || out.error === "CLAIM_KEY_INVALID"
              || out.error === "CLAIM_KEYPAIR_MISMATCH"
            ? 400
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
  });

  if (!out.ok) {
    const status =
      out.error === "CLAIM_NOT_FOUND"
        ? 404
        : out.error === "CLAIM_VERIFICATION_FAILED"
          ? 403
          : out.error === "NAMESPACE_REQUIRED" || out.error === "SECRET_REQUIRED"
            ? 400
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
  const transportHost = resolveTransportHost(req);
  const forwardedHost = resolveHostNamespace(req);
  const target = normalizeHttpRequestToMeTarget(req);
  const lens = formatObserverRelationLabel(target.relation);
  const forwardedSuffix = forwardedHost && forwardedHost !== transportHost
    ? ` xf=${forwardedHost}`
    : "";
  console.log(
    `→ ${req.method} ${req.url} host=${transportHost || "unknown"} ns=${target.namespace} lens=${lens} op=${target.operation} nrp=${target.nrp}${forwardedSuffix}`
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
    return res.status(400).json(createErrorEnvelope(target, {
      error: "Expected JSON block in request body",
    }));
  }

  if (operation === "claim") {
    if (commandTarget && !isCanonicalClaimableNamespace(resolvedNamespace)) {
      return res.status(400).json(createErrorEnvelope(commandTarget, {
        error: "FULL_NAMESPACE_REQUIRED",
        detail: "Public claims should use a full namespace such as username.cleaker.me.",
      }));
    }

    const out = claimNamespace({
      namespace: resolvedNamespace,
      secret: String((body as any)?.secret || ""),
      publicKey: String((body as any)?.publicKey || "").trim() || null,
      privateKey: String((body as any)?.privateKey || "").trim() || null,
    });

    const claimTarget = commandTarget || buildNormalizedTarget(req, resolvedNamespace, "claim", "");
    if (!out.ok) {
      const status =
        out.error === "NAMESPACE_TAKEN"
          ? 409
          : out.error === "NAMESPACE_REQUIRED"
              || out.error === "SECRET_REQUIRED"
              || out.error === "CLAIM_KEY_INVALID"
              || out.error === "CLAIM_KEYPAIR_MISMATCH"
            ? 400
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
    });

    const openTarget = commandTarget || buildNormalizedTarget(req, resolvedNamespace, "open", "");
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
  const target = normalizeHttpRequestToMeTarget(req);
  const lens = formatObserverRelationLabel(target.relation);
  const limit = Math.max(1, Math.min(5000, Number((req.query as any)?.limit ?? 5000)));
  const identityHash = String((req.query as any)?.identityHash || "").trim();
  const rootNamespace = resolveNamespaceProjectionRoot(chainNs) || chainNs;

  const all = await getAllBlocks();
  const users = await getUsersForRootNamespace(rootNamespace);

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
    rootNamespace,
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
  const target = normalizeHttpRequestToMeTarget(req);
  const lens = formatObserverRelationLabel(target.relation);
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

app.get("/blockchain", async (req: express.Request, res: express.Response) => {
  const chainNs = resolveNamespace(req);
  const rootNamespace = resolveNamespaceProjectionRoot(chainNs) || chainNs;
  const target = normalizeHttpRequestToMeTarget(req);
  const lens = formatObserverRelationLabel(target.relation);
  const limit = Math.max(1, Math.min(5000, Number((req.query as any)?.limit ?? 500)));

  const memories = listSemanticMemoriesByRootNamespace(rootNamespace, { limit });

  return res.json(createEnvelope(target, {
    namespace: chainNs,
    rootNamespace,
    lens,
    memories,
    count: memories.length,
  }));
});

// --- Convenience: allow GET /@... to behave like GET / but with path-based namespace addressing.
// NOTE: This MUST be defined before the catch-all path resolver.
app.get("/@*", async (req: express.Request, res: express.Response) => {
  const chainNs = resolveNamespace(req);
  const target = normalizeHttpRequestToMeTarget(req);
  const lens = formatObserverRelationLabel(target.relation);
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
  console.log("  - Kernel claim:   POST /me/kernel:claim/<full-namespace>");
  console.log("  - Kernel open:    POST /me/kernel:open/<full-namespace>");

  console.log("\n🌐 Routing / Namespaces");
  console.log("  - Host header determines the chain namespace");
  console.log("  - Examples:");
  console.log("    • cleaker.me                  -> cleaker.me");
  console.log("    • username.cleaker.me         -> username.cleaker.me");
  console.log(`    • localhost (alias)           -> ${LOCAL_NAMESPACE_ROOT}`);
  console.log(`    • username.localhost          -> username.${LOCAL_NAMESPACE_ROOT} (local alias projection)`);
  console.log("    • cleaker.me/@username        -> username.cleaker.me (path projection)");
  console.log(`    • localhost/@username         -> username.${LOCAL_NAMESPACE_ROOT} (local alias projection)`);
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
  console.log("  - Lookup user:    GET  /users/:username");
  console.log("  - Enroll face:    POST /faces/enroll");
  console.log("  - Match face:     POST /faces/match\n");
});
