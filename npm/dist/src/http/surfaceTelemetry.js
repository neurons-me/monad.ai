"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSurfaceTelemetrySnapshot = getSurfaceTelemetrySnapshot;
exports.recordSurfaceRequest = recordSurfaceRequest;
exports.attachSurfaceStreamClient = attachSurfaceStreamClient;
const os_1 = __importDefault(require("os"));
const MAX_RECENT_REQUESTS = Math.max(20, Math.min(500, Number(process.env.MONAD_SURFACE_RECENT_REQUESTS || 120)));
const REQUEST_RATE_WINDOW_MS = Math.max(1000, Math.min(60000, Number(process.env.MONAD_SURFACE_RATE_WINDOW_MS || 10000)));
const REQUEST_RATE_PRESSURE_THRESHOLD = Math.max(1, Number(process.env.MONAD_SURFACE_REQUEST_THRESHOLD || 40));
const SURFACE_POLICY_BLOCKCHAIN_LIMIT = Math.max(5, Number(process.env.MONAD_SURFACE_POLICY_GUI_BLOCKCHAIN_LIMIT || 80));
const SURFACE_BUDGET_BLOCKCHAIN_ROWS = Math.max(5, Number(process.env.MONAD_SURFACE_BUDGET_GUI_BLOCKCHAIN_ROWS || 50));
const SURFACE_STREAM_HEARTBEAT_MS = Math.max(1000, Math.min(30000, Number(process.env.MONAD_SURFACE_STREAM_HEARTBEAT_MS || 3000)));
let nextRequestId = 1;
let nextClientId = 1;
const recentRequests = [];
const clients = new Set();
function clamp01(value) {
    if (!Number.isFinite(value))
        return 0;
    if (value <= 0)
        return 0;
    if (value >= 1)
        return 1;
    return value;
}
function computeCpuUsageRatio() {
    const cores = Math.max(1, os_1.default.cpus()?.length || 1);
    const load = Number(os_1.default.loadavg?.()[0] || 0);
    return clamp01(load / cores);
}
function getRecentRequestRatePer10s(now) {
    const recent = recentRequests.filter((event) => now - event.timestamp <= REQUEST_RATE_WINDOW_MS);
    return recent.length;
}
function computeRequestPressure(now) {
    const rate = getRecentRequestRatePer10s(now);
    return clamp01(rate / REQUEST_RATE_PRESSURE_THRESHOLD);
}
function getSurfaceTelemetrySnapshot() {
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
function writeSseEvent(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}
function broadcast(event, data) {
    for (const client of clients) {
        writeSseEvent(client.res, event, data);
    }
}
function recordSurfaceRequest(input) {
    const event = {
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
function attachSurfaceStreamClient(req, res) {
    const client = {
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
        if (res.writableEnded || res.destroyed)
            return;
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
