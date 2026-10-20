import {TPathSet} from '@/Carburetor/Models/Paths';
import {ISubscriberRecord} from '@/Carburetor/Store/Utils/Models';
import {pathsIntersect} from '@/Carburetor/Store/Paths/Diff/pathsIntersect';
import {diagnostics} from '@/Carburetor/Store/Diagnostics/DiagnosticsInstance';
import {traceListeners} from '@/Carburetor/Store/Diagnostics/Internal/listeners';
import {metadata} from '@/Carburetor/Store/Diagnostics/Internal/metadata';

interface IPendingTrace {
    /** Accumulated matching paths until callback delivery. */
    paths: Set<string>;
    /** Latest store version before callback delivery. */
    version: number;
    /** Original subscriber callback to invoke after notifying trace listeners. */
    callback: () => void;
    /** Listener session epoch that owns this queued delivery. */
    epoch: number;
}

const pending = new WeakMap<ISubscriberRecord, IPendingTrace>();

/** Creates or joins a pending trace for the subscriber delivery.
 *
 * @param active - whether diagnostics tracing is active.
 * @param id - fallback subscriber identifier.
 * @param store - store identifier.
 * @param record - subscriber record being delivered.
 * @param writes - paths written by this update.
 * @param version - latest store version.
 * @param current - returns the current subscriber record.
 */
export const deliveryCallback = (active: boolean, id: string, store: string, record: ISubscriberRecord,
    writes: TPathSet, version: number, current: () => ISubscriberRecord | undefined): (() => void) => {
    if (!active) return record.callback;
    let trace = pending.get(record);
    if (!trace) {
        trace = {paths: new Set<string>(), version, callback: record.callback, epoch: traceListeners.epoch};
        pending.set(record, trace);
    }
    if (trace.epoch !== traceListeners.epoch) {
        trace.paths.clear();
        trace.epoch = traceListeners.epoch;
    }
    if (diagnostics.isTracing()) {
        for (const path of writes) {
            if (pathsIntersect(record.reads, new Set([path]))) trace.paths.add(path);
        }
    }
    trace.version = version;
    return (): void => {
        if (pending.get(record) !== trace) return;
        pending.delete(record);
        if (current() !== record) return;
        if (trace.epoch === traceListeners.epoch && diagnostics.isTracing()) {
            diagnostics.traceUpdate(
                metadata.callbackNames.get(record.callback) ?? id, store, trace.paths, trace.version
            );
        }
        trace.callback();
    };
};
