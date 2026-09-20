import { IUpdateScheduler, TTimerHandle, TUpdater } from "./Models.js";
/**
 * A policy for streaming sources: a socket pushing a thousand messages per second,
 * mousemove, presence cursors. There updates arrive in separate ticks and coalescing
 * genuinely helps. Regular UI does not need it — a carburetor delivers updates immediately
 * by default.
 */
export declare class ComponentUpdateThrottle implements IUpdateScheduler {
    protected updateTimeout: number;
    protected maxUpdateDepth: number;
    protected timeout: TTimerHandle;
    protected updaters: Map<string, TUpdater>;
    constructor(updateTimeout?: number);
    schedule: (uid: string, updater: TUpdater) => void;
    cancel: (uid: string) => void;
    protected setupTimeout: () => void;
    protected clearTimeout: () => void;
    protected runUpdater: (updater: TUpdater) => void;
    protected letsUpdate: () => void;
}
