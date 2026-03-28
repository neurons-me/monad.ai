import os from "os";
import type express from "express";

export type SurfaceRequestEvent = {
  id: number;
  timestamp: number;
  method: string;
  url: string;
  status: number;
  durationMs: number;
  host: string;
  namespace: string;
  operation: string;
  nrp: string;
  lens: string;
  forwardedHost: string | null;
};

export type SurfaceTelemetrySnapshot = {
  usage: {
    cpu: number;
    requestRatePer10s: number;
  };
  pressure: {
    cpu: number;
  };
  policy: {
    gui: {
      blockchain: {
        limit: number;
      };
    };
  };
  budget: {
    gui: {
      blockchain: {
        rows: number;
      };
    };
  };
  monitor: {
    recentRequests: SurfaceRequestEvent[];
  };
};

type SurfaceRequestInput = Omit<SurfaceRequestEvent, "id" | "timestamp"> & {
  timestamp?: number;
};

type SurfaceStreamClient = {
  id: number;
  res: express.Response;
};

const MAX_RECENT_REQUESTS = Math.max(20, Math.min(500, Number(process.env.MONAD_SURFACE_RECENT_REQUESTS || 120)));
const REQUEST_RATE_WINDOW_MS = Math.max(1_000, Math.min(60_000, Number(process.env.MONAD_SURFACE_RATE_WINDOW_MS || 10_000)));
const REQUEST_RATE_PRESSURE_THRESHOLD = Math.max(1, Number(process.env.MONAD_SURFACE_REQUEST_THRESHOLD || 40));
const SURFACE_POLICY_BLOCKCHAIN_LIMIT = Math.max(5, Number(process.env.MONAD_SURFACE_POLICY_GUI_BLOCKCHAIN_LIMIT || 80));
const SURFACE_BUDGET_BLOCKCHAIN_ROWS = Math.max(5, Number(process.env.MONAD_SURFACE_BUDGET_GUI_BLOCKCHAIN_ROWS || 50));
const SURFACE_STREAM_HEARTBEAT_MS = Math.max(1_000, Math.min(30_000, Number(process.env.MONAD_SURFACE_STREAM_HEARTBEAT_MS || 3_000)));

let nextRequestId = 1;
let nextClientId = 1;
const recentRequests: SurfaceRequestEvent[] = [];
const clients = new Set<SurfaceStreamClient>();

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function computeCpuUsageRatio() {
  const cores = Math.max(1, os.cpus()?.length || 1);
  const load = Number(os.loadavg?.()[0] || 0);
  return clamp01(load / cores);
}

function getRecentRequestRatePer10s(now: number) {
  const recent = recentRequests.filter((event) => now - event.timestamp <= REQUEST_RATE_WINDOW_MS);
  return recent.length;
}

function computeRequestPressure(now: number) {
  const rate = getRecentRequestRatePer10s(now);
  return clamp01(rate / REQUEST_RATE_PRESSURE_THRESHOLD);
}

export function getSurfaceTelemetrySnapshot(): SurfaceTelemetrySnapshot {
  const now = Date.now();
  const cpuUsage = computeCpuUsageRatio();
  const requestPressure = computeRequestPressure(now);
  const cpuPressure = Math.max(cpuUsage, requestPressure);

  return {
    usage: {
      cpu: cpuUsage,
      requestRatePer10s: getRecentRequestRatePer10s(now),
    },
    pressure: {
      cpu: cpuPressure,
    },
    policy: {
      gui: {
        blockchain: {
          limit: SURFACE_POLICY_BLOCKCHAIN_LIMIT,
        },
      },
    },
    budget: {
      gui: {
        blockchain: {
          rows: SURFACE_BUDGET_BLOCKCHAIN_ROWS,
        },
      },
    },
    monitor: {
      recentRequests: recentRequests.slice(0, MAX_RECENT_REQUESTS),
    },
  };
}

function writeSseEvent(res: express.Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event: string, data: unknown) {
  for (const client of clients) {
    writeSseEvent(client.res, event, data);
  }
}

export function recordSurfaceRequest(input: SurfaceRequestInput) {
  const event: SurfaceRequestEvent = {
    id: nextRequestId++,
    timestamp: typeof input.timestamp === "number" ? input.timestamp : Date.now(),
    method: String(input.method || "GET").trim().toUpperCase(),
    url: String(input.url || "").trim(),
    status: Number(input.status || 0) || 0,
    durationMs: Math.max(0, Number(input.durationMs || 0)),
    host: String(input.host || "").trim(),
    namespace: String(input.namespace || "").trim(),
    operation: String(input.operation || "").trim(),
    nrp: String(input.nrp || "").trim(),
    lens: String(input.lens || "").trim(),
    forwardedHost: input.forwardedHost ? String(input.forwardedHost).trim() : null,
  };

  recentRequests.unshift(event);
  if (recentRequests.length > MAX_RECENT_REQUESTS) {
    recentRequests.length = MAX_RECENT_REQUESTS;
  }

  broadcast("request", {
    request: event,
    telemetry: getSurfaceTelemetrySnapshot(),
  });
}

export function attachSurfaceStreamClient(req: express.Request, res: express.Response) {
  const client: SurfaceStreamClient = {
    id: nextClientId++,
    res,
  };

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`retry: 2000\n\n`);

  clients.add(client);
  writeSseEvent(res, "surface", getSurfaceTelemetrySnapshot());

  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) return;
    writeSseEvent(res, "surface", getSurfaceTelemetrySnapshot());
  }, SURFACE_STREAM_HEARTBEAT_MS);
  heartbeat.unref?.();

  const cleanup = () => {
    clearInterval(heartbeat);
    clients.delete(client);
  };

  req.on("aborted", cleanup);
  req.on("close", cleanup);
  res.on("close", cleanup);
}
