import { normalizeSurfaceRoute } from "../http/provider.js";
import { resolveTransportHost } from "../http/namespace.js";
export function resolveRequestOrigin(req, fallbackHost) {
    const host = resolveTransportHost(req);
    const hostHeader = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host || host;
    return `${req.protocol}://${String(hostHeader || fallbackHost || host).trim()}`;
}
export function resolveRequestSurfaceRoute(req) {
    const hinted = String(req.query?.route || "").trim();
    return normalizeSurfaceRoute(hinted || req.path || "/");
}
