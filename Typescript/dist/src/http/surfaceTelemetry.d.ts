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
    /** Ed25519 identity hash of the authenticated caller, when available. */
    identityHash: string | null;
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
type SurfaceRequestInput = Omit<SurfaceRequestEvent, "id" | "timestamp" | "identityHash"> & {
    timestamp?: number;
    identityHash?: string | null;
};
type SurfaceRequestListener = (event: SurfaceRequestEvent) => void;
/**
 * Registers a callback that fires synchronously after every surface request is
 * recorded.  Returns an unsubscribe function.
 *
 * Listeners MUST NOT throw — exceptions are caught and silently discarded so
 * they can never break request-handling.  Kept in module scope (not per-server)
 * because `recordSurfaceRequest` is a module-level function.
 *
 * @example
 * ```typescript
 * const off = addSurfaceRequestListener(event => ledger.record(event));
 * // later:
 * off();
 * ```
 */
export declare function addSurfaceRequestListener(fn: SurfaceRequestListener): () => void;
export declare function getSurfaceTelemetrySnapshot(): SurfaceTelemetrySnapshot;
export declare function recordSurfaceRequest(input: SurfaceRequestInput): void;
export declare function attachSurfaceStreamClient(req: express.Request, res: express.Response): void;
export {};
