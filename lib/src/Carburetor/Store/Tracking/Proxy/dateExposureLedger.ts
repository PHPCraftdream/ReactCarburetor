import {PATCH_OPAQUE, RAW_EXPOSURE, TPath, TPatchPort, TWriteRecorder} from "@/Carburetor/Models/Paths";
import {branchPath} from "@/Carburetor/Store/Paths/Markers/BranchMarker";
import {IProxyCache} from "@/Carburetor/Store/Tracking/Models";
import {nativeAliasIndex} from "@/Carburetor/Store/Tracking/Aliases/NativeAliasIndex";
import {liveViews} from "@/Carburetor/Store/Tracking/Proxy/liveViews";
import {isOrdinaryDate} from "@/Carburetor/Store/Tracking/Proxy/Definitions/isOrdinaryDate";

interface IExposure {
    baseline: number;
    readonly entries: Array<{readonly source: object; readonly key: string; readonly root: object;
        readonly record: TWriteRecorder; readonly path: TPath; readonly cache: IProxyCache}>;
}

const exposures = new WeakMap<TPatchPort, Map<Date, IExposure>>();

/** Tracks exposed Dates per patch port until a synchronous boundary or microtask cleanup. */
export const dateExposureLedger = {
    /** Adapts an opaque value and conservatively records its exposure.
     *
     * @param value - the opaque value to adapt.
     * @param port - the patch port receiving exposure notifications.
     * @param root - the state root, when available.
     * @param source - the containing object.
     * @param key - the property key containing the value.
     * @param record - the write recorder.
     * @param path - the value's state path.
     * @param cache - the proxy cache used for adaptation.
     */
    adapt(value: object, port: TPatchPort | undefined, root: object | undefined, source: object, key: string,
        record: TWriteRecorder, path: TPath, cache: IProxyCache): object {
        port?.listener?.(PATCH_OPAQUE);
        if (root !== undefined) nativeAliasIndex.noteChange(root, source, key, value, value, path);
        record(path, value);
        record(branchPath(path), RAW_EXPOSURE);
        return liveViews.adaptNativeCollection(value, cache, source, key);
    },

    /** Records a Date exposure and schedules at most one final cleanup per port.
     *
     * @param port - the patch port receiving exposure notifications.
     * @param source - the containing object.
     * @param key - the property key containing the Date.
     * @param date - the exposed Date.
     * @param root - the state root, when available.
     * @param record - the write recorder.
     * @param path - the Date's state path.
     * @param cache - the proxy cache used for adaptation.
     */
    expose(port: TPatchPort | undefined, source: object, key: string, date: Date,
        root: object | undefined, record: TWriteRecorder, path: TPath, cache: IProxyCache): void {
        if (port === undefined || root === undefined) return;
        let ledger = exposures.get(port);
        if (ledger === undefined) {
            ledger = new Map();
            exposures.set(port, ledger);
            const scheduled = ledger;
            queueMicrotask(() => queueMicrotask(() => {
                if (exposures.get(port) === scheduled) {
                    scheduled.clear();
                    exposures.delete(port);
                }
            }));
        }
        let exposure = ledger.get(date);
        if (exposure === undefined) {
            exposure = {baseline: Date.prototype.getTime.call(date), entries: []};
            ledger.set(date, exposure);
        }
        // Keep distinct paths after movement; stale aliases are retained conservatively.
        if (!exposure.entries.some(entry => entry.source === source && entry.key === key && entry.root === root &&
            entry.path === path)) {
            exposure.entries.push({source, key, root, record, path, cache});
        }
    },

    /** Flushes Date mutations since each exposure baseline; returns whether any changed.
     *
     * @param port - the patch port whose exposures are flushed.
     */
    flush(port: TPatchPort): boolean {
        const ledger = exposures.get(port);
        if (ledger === undefined || ledger.size === 0) return false;
        let failed = false;
        let firstError: unknown;
        let changed = false;
        for (const [date, exposure] of ledger) {
            for (let index = exposure.entries.length - 1; index >= 0; index--) {
                const item = exposure.entries[index];
                const descriptor = Reflect.getOwnPropertyDescriptor(item.source, item.key);
                if (descriptor === undefined || !("value" in descriptor) || descriptor.value !== date) {
                    exposure.entries.splice(index, 1);
                }
            }
            // A detached Date with no live edge must not wake listeners.
            if (exposure.entries.length === 0) {
                ledger.delete(date);
                continue;
            }
            if (!isOrdinaryDate(date)) {
                changed = true;
                for (const item of exposure.entries) {
                    try {
                        this.adapt(date, port, item.root, item.source, item.key,
                            item.record, item.path, item.cache);
                    } catch (error: unknown) {
                        if (!failed) firstError = error;
                        failed = true;
                    }
                }
                ledger.delete(date);
                continue;
            }
            const time = Date.prototype.getTime.call(date);
            if (Object.is(time, exposure.baseline)) continue;
            changed = true;
            exposure.baseline = time;
            try { port.listener?.(PATCH_OPAQUE); }
            catch (error: unknown) { if (!failed) firstError = error; failed = true; }
            for (const item of exposure.entries) {
                try {
                    nativeAliasIndex.noteChange(item.root, item.source, item.key, date, date, item.path);
                    item.record(item.path, date);
                    item.record(branchPath(item.path), RAW_EXPOSURE);
                } catch (error: unknown) {
                    if (!failed) firstError = error;
                    failed = true;
                }
            }
        }
        if (failed) throw firstError;
        return changed;
    },
};
