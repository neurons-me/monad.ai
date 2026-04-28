import type express from "express";
import { normalizeSurfaceRoute } from "../http/provider.js";
import { resolveTransportHost } from "../http/namespace.js";

export function resolveRequestOrigin(req: express.Request, fallbackHost?: string): string {
  const host = resolveTransportHost(req);
  const hostHeader = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host || host;
  return `${req.protocol}://${String(hostHeader || fallbackHost || host).trim()}`;
}

export function resolveRequestSurfaceRoute(req: express.Request): string {
  const hinted = String((req.query as any)?.route || "").trim();
  return normalizeSurfaceRoute(hinted || req.path || "/");
}
