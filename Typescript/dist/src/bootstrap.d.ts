import { type SelfNodeConfig } from "./http/selfMapping.js";
export type MonadLogger = Pick<Console, "log" | "warn" | "error">;
export interface MonadOptions {
    port?: string | number;
    hostname?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    seed?: string;
    namespace?: string;
    stateDir?: string;
    claimDir?: string;
    selfConfigPath?: string;
    selfIdentity?: string;
    selfHostname?: string;
    selfEndpoint?: string;
    selfTags?: string | string[];
    selfType?: string;
    selfTrust?: string;
    selfResources?: string | string[];
    guiPkgDistDir?: string;
    mePkgDistDir?: string;
    cleakerPkgDistDir?: string;
    reactUmdDir?: string;
    reactDomUmdDir?: string;
    routesPath?: string;
    indexPath?: string;
    fetchProxyTimeoutMs?: number;
    logger?: MonadLogger | false;
}
export interface MonadRuntimeConfig {
    cwd: string;
    env: NodeJS.ProcessEnv;
    port: string | number;
    nodeHostname: string;
    nodeDisplayName: string;
    fetchProxyTimeoutMs: number;
    mePkgDistDir: string;
    cleakerPkgDistDir: string;
    guiPkgDistDir: string;
    reactUmdDir: string;
    reactDomUmdDir: string;
    routesPath: string;
    indexPath: string;
    selfNodeConfig: SelfNodeConfig | null;
    localNamespaceRoot: string;
}
export interface MonadBootstrapResult {
    config: MonadRuntimeConfig;
    kernelStateDir: string;
    rebuiltProjectedClaims: number;
    seededSemanticBootstrap: number;
    /**
     * `true` when the resource usage ledger bridge started successfully.
     * The ledger is the bridge between surface telemetry and the signed semantic
     * ledger — it materialises per-request events and window snapshots so
     * NetGet can aggregate usage and budgets.
     */
    usageLedgerStarted: boolean;
}
export declare function resolveMonadRuntimeConfig(options?: MonadOptions): MonadRuntimeConfig;
export declare function bootstrapMonad(options?: MonadOptions): Promise<MonadBootstrapResult>;
