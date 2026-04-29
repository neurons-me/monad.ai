import express from "express";
import cors from "cors";
import os from "os";
import path from "path";
import { getKernel, getKernelStateDir } from "./src/kernel/manager.js";
import { setupPersistence } from "./src/kernel/persist.js";
import { rebuildProjectedNamespaceClaims } from "./src/claim/records.js";
import { ensureRootSemanticBootstrap } from "./src/claim/semanticBootstrap.js";
import { formatObserverRelationLabel, resolveHostNamespace, resolveTransportHost } from "./src/http/namespace.js";
import { normalizeHttpRequestToMeTarget } from "./src/http/meTarget.js";
import { createClaimsRouter } from "./src/http/claims.js";
import { createSessionRouter } from "./src/http/session.js";
import { createLegacyRouter } from "./src/http/legacy.js";
import { loadSelfNodeConfig } from "./src/http/selfMapping.js";
import { recordSurfaceRequest } from "./src/http/surfaceTelemetry.js";
import { normalizeNamespaceIdentity, normalizeNamespaceRootName } from "./src/namespace/identity.js";
import { GUI_PKG_DIST_DIR } from "./src/http/shell.js";
import { buildProviderBoot, createProviderSurface, type ProviderSurfaceConfig } from "./src/surfaces/providerSurface.js";
import type { NamespaceProviderBoot } from "./src/http/provider.js";
import { createFetchSurface } from "./src/surfaces/fetchSurface.js";
import { createBridgeHandler } from "./src/handlers/bridgeHandler.js";
import { meCommandHandler, rootCommandHandler, rootCompatHandler } from "./src/handlers/commandHandler.js";
import { createLedgerHandlers } from "./src/handlers/ledgerHandler.js";
import { commitHandler, syncEventsHandler } from "./src/handlers/syncHandler.js";

// --- Config
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

// --- Handler factories
const surfaceConfig: ProviderSurfaceConfig = {
  selfNodeConfig: SELF_NODE_CONFIG,
  hostname: NODE_HOSTNAME,
  displayName: NODE_DISPLAY_NAME,
};

function buildRequestProviderBoot(req: express.Request, namespace: string): NamespaceProviderBoot | null {
  return buildProviderBoot(req, namespace, surfaceConfig);
}

const bridgeHandler = createBridgeHandler({
  hostname: NODE_HOSTNAME,
  port: PORT,
  selfNodeConfig: SELF_NODE_CONFIG,
});

const ledger = createLedgerHandlers({
  buildRequestProviderBoot,
  onBridgeRequest: bridgeHandler,
});

// --- Bootstrap
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

// --- Static assets
const noCache = createNoCacheStaticOptions();
app.use("/gui",           express.static(GUI_PKG_DIST_DIR,       noCache));
app.use("/me",            express.static(ME_PKG_DIST_DIR,         noCache));
app.use("/cleaker",       express.static(CLEAKER_PKG_DIST_DIR,    noCache));
app.use("/vendor/react",  express.static(LOCAL_REACT_UMD_DIR,     noCache));
app.use("/vendor/react-dom", express.static(LOCAL_REACTDOM_UMD_DIR, noCache));
app.get("/routes.js", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res.sendFile(MONAD_ROUTES_PATH);
});

// --- Surfaces
app.use(createProviderSurface(surfaceConfig));
app.use(createFetchSurface({ timeoutMs: FETCH_PROXY_TIMEOUT_MS }));

// --- Routes
app.get("/resolve",         bridgeHandler);
app.post("/me/*",           meCommandHandler);
app.get("/",                ledger.root);
app.use(requestLogger());
app.post("/",               rootCompatHandler);
app.post("/",               rootCommandHandler);
app.get("/",                ledger.rootRead);
app.get("/blocks",          ledger.blocks);
app.get("/blockchain",      ledger.blockchain);
app.get("/@*",              ledger.atPath);
app.post("/api/v1/commit",  commitHandler);
app.get("/api/v1/sync",     syncEventsHandler);
app.use(createClaimsRouter());
app.use(createSessionRouter());
app.use(createLegacyRouter());
app.get("/*",               ledger.catchAll);

// --- Request logger (cross-cutting)
function requestLogger(): express.RequestHandler {
  return (req, _res, next) => {
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
  };
}

// --- Start
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
    if (SELF_NODE_CONFIG) {
      console.log("\n🪞 Self Mapping");
      console.log(`  - Identity:       ${SELF_NODE_CONFIG.identity}`);
      console.log(`  - Tags:           ${SELF_NODE_CONFIG.tags.join(", ") || "(none)"}`);
      console.log(`  - Endpoint:       ${SELF_NODE_CONFIG.endpoint}`);
      console.log(`  - Config Path:    ${SELF_NODE_CONFIG.configPath}`);
    }
    console.log("\n🔎 Namespace Reads");
    console.log("  - Resolve path:   GET  /<any/path>   e.g. /profile/displayName");
    console.log("\n🕰 Legacy Extensions");
    console.log("  - Claim username: POST /users");
    console.log("  - Lookup user:    GET  /users/:username\n");
  });
}

export default app;
