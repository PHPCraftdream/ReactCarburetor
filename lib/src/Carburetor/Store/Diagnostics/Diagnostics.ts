import {TDisposer} from '../../Models/Base';
import {TUpdateTraceListener} from './TraceListener';
import {traceListeners} from './Internal/listeners';
import {metadata} from './Internal/metadata';
import {IS_DEVELOPMENT} from '../Utils/DevelopmentFlag';

declare const process: {env: {NODE_ENV?: string}};

/**
 * Development-only complaints about misuse — a write that was never published, a
 * transaction handed an async body. They are on in development and off in production, and
 * can be switched explicitly: tests that assert on a mistake want them on, a noisy dev
 * session may want them off.
 *
 * Call sites also wrap the call in `if (IS_DEVELOPMENT)` so a production bundle drops the
 * message strings entirely rather than merely skipping the call.
 */
export class Diagnostics {
    /** Controls whether diagnostic callbacks are currently enabled. */
    protected enabled: boolean = IS_DEVELOPMENT;
    /** Minimum committed read-path count that triggers a wide-read warning. */
    private wideReadThreshold = Infinity;

    /** Whether complaints are currently reported. */
    public isEnabled(): boolean { return this.enabled; }

    /** Turns complaints on or off.
     *
     * @param enabled - whether complaints should be reported.
     */
    public setEnabled(enabled: boolean): void { this.enabled = enabled; }

    /** Subscribe to delivered subscriber callback traces; production tracing is a no-op.
     *
     * Every call creates an independent registration: the same listener may be registered
     * several times, and a disposer removes only its own registration.
     *
     * @param listener - called with each delivered update trace.
     */
    public traceUpdates(listener: TUpdateTraceListener): TDisposer {
        if (process.env.NODE_ENV !== 'production') {
            const registration = {listener};
            traceListeners.registrations.add(registration);
            if (traceListeners.registrations.size === 1) traceListeners.epoch++;
            return (): void => {
                if (!traceListeners.registrations.delete(registration)) return;
                if (traceListeners.registrations.size === 0) traceListeners.epoch++;
            };
        }
        return (): void => undefined;
    }

    /** Whether callback tracing currently has active registrations. */
    public isTracing(): boolean {
        return process.env.NODE_ENV !== 'production'
            && traceListeners.registrations.size > 0;
    }

    /** Notifies registered listeners of one update trace.
     *
     * @param subscriber - subscriber identifier.
     * @param store - store identifier.
     * @param paths - immutable paths changed by this update.
     * @param version - store version delivered.
     */
    public traceUpdate(subscriber: string, store: string, paths: ReadonlySet<string>, version: number): void {
        if (process.env.NODE_ENV !== 'production' && this.isTracing()) {
            traceListeners.notify(subscriber, store, paths, version);
        }
    }

    /** Sets the minimum committed read-path count that triggers a warning.
     *
     * @param threshold - minimum count; Infinity disables warnings.
     */
    public setWideReadThreshold(threshold: number): void {
        if (typeof threshold !== 'number' || Number.isNaN(threshold) || threshold < 0) {
            throw new RangeError('Expected a non-negative number or Infinity');
        }
        this.wideReadThreshold = threshold;
    }

    /** Returns the minimum committed read-path count that triggers a warning. */
    public getWideReadThreshold(): number { return this.wideReadThreshold; }

    /** Associates a display label and callback with a component for warning messages.
     *
     * @param component - component receiving diagnostics.
     * @param name - label to include in warnings.
     * @param callback - optional update callback used to label store subscriptions.
     */
    public registerComponent(component: object, name: string, callback?: object): void {
        if (process.env.NODE_ENV === 'production') return;
        metadata.componentNames.set(component, name);
        if (callback) metadata.callbackNames.set(callback, name);
    }

    /** Reports a wide committed read set once for each component/store pair.
     *
     * @param component - component that committed the reads.
     * @param store - store whose paths were read.
     * @param storeUid - store identifier shown in the warning.
     * @param count - number of committed read paths.
     */
    public reportWideRead(component: object, store: object, storeUid: string, count: number): void {
        if (process.env.NODE_ENV === 'production' || !this.enabled
            || count <= this.wideReadThreshold) return;
        let reported = metadata.wideReadReported.get(component);
        if (!reported) metadata.wideReadReported.set(component, reported = new WeakSet<object>());
        if (reported.has(store)) return;
        reported.add(store);
        const name = metadata.callbackNames.get(store) ?? metadata.callbackNames.get(component)
            ?? metadata.componentNames.get(component) ?? 'subscriber';
        this.report(`Wide read by ${name} from store ${storeUid}: ${count} paths (threshold ${this.wideReadThreshold}).
Consider computed values for derived data, connectSelection for narrow component reads, or child components per row.`);
    }

    /** Reports one complaint, prefixed so its source is obvious in a console.
     *
     * @param message - complaint text to report.
     */
    public report(message: string): void {
        if (!this.enabled) return;
        // eslint-disable-next-line no-console
        console.error('Carburetor: ' + message);
    }
}
