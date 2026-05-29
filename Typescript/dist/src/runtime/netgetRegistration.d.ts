import type { MonadBootstrapResult, MonadLogger } from "../bootstrap.js";
export interface MonadNetGetRegistration {
    id: string;
    endpoint: string;
    report(): Promise<void>;
    stop(): Promise<void>;
}
export type NetGetRegistrationPayload = {
    id: string;
    name: string;
    kind: "monad";
    pid: number;
    cwd: string;
    hostname: string;
    port: number;
    protocol: "http";
    host: string;
    url: string;
    tags: string[];
    metadata: Record<string, unknown>;
    status: "running";
    health: {
        state: "healthy";
        updatedAt: string;
        message?: string;
    };
    ui: {
        hasAdminPanel: boolean;
        hasUserPanel: boolean;
        defaultPath: string;
    };
    exposure: Record<string, unknown>;
    lifecycle: Record<string, boolean>;
    startedAt: string;
    updatedAt: string;
    ttlMs: number;
    mode: "fixed";
    portStatus: "active";
};
export declare function buildNetGetMonadExposure(monadName: string): {
    enabled: boolean;
    visibility: string;
    publishMode: string;
    inbound: {
        allowHttp: boolean;
        allowHttps: boolean;
        allowWebsocket: boolean;
        bindHosts: string[];
        paths: string[];
    };
    tls: {
        mode: string;
        redirectHttpToHttps: boolean;
    };
    auth: {
        mode: string;
        requiredForRead: boolean;
        requiredForControl: boolean;
        requiredForDestructive: boolean;
        rolesAllowed: string[];
    };
    control: {
        read: boolean;
        control: boolean;
        destructive: boolean;
    };
    network: {
        allowLoopback: boolean;
        allowLan: boolean;
        allowWan: boolean;
        allowCidrs: never[];
        denyCidrs: never[];
        trustedProxies: never[];
    };
    redirect: {
        additionalHosts: never[];
        forceCanonicalHost: boolean;
    };
    headers: {
        forwardedHost: boolean;
        forwardedProto: boolean;
        forwardedFor: boolean;
        frameAncestors: string[];
    };
};
export declare function buildNetGetMonadRegistrationPayload(input: {
    bootstrap: MonadBootstrapResult;
    id: string;
    startedAt: string;
    heartbeatMs: number;
}): NetGetRegistrationPayload | null;
export declare function startNetGetMonadRegistration(bootstrap: MonadBootstrapResult, logger?: MonadLogger | null): MonadNetGetRegistration | null;
