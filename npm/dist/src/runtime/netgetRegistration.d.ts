import type { MonadBootstrapResult, MonadLogger } from "../bootstrap.js";
export interface MonadNetGetRegistration {
    id: string;
    endpoint: string;
    report(): Promise<void>;
    stop(): Promise<void>;
}
export declare function startNetGetMonadRegistration(bootstrap: MonadBootstrapResult, logger?: MonadLogger | null): MonadNetGetRegistration | null;
