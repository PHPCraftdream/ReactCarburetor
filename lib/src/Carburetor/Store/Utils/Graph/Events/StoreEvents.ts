import {TDisposer} from "@/Carburetor/Models/Base";
import {reportDeliveryFailure} from "@/Carburetor/Store/Diagnostics/reportDeliveryFailure";

interface IEventListener {
    callback: (payload: never) => void;
    active: boolean;
}

/** Typed one-off event channel of one store: listeners, delivery and disposal. */
export class StoreEvents<TEvents extends object> {
    /** Listeners by event name, created on the first registration. */
    private listeners?: Map<keyof TEvents, Set<IEventListener>>;
    /** Set once by dispose; later registrations are no-ops. */
    private disposed = false;

    /** Registers one typed event listener.
     *
     * @param name - event name
     * @param listener - callback receiving the event payload
     */
    public on<K extends keyof TEvents>(name: K, listener: (payload: TEvents[K]) => void): TDisposer {
        if (this.disposed) return (): void => {};
        const listeners = this.listeners ??= new Map();
        let group = listeners.get(name);
        if (!group) listeners.set(name, group = new Set());
        const record: IEventListener = {callback: listener as (payload: never) => void, active: true};
        group.add(record);
        return (): void => {
            if (!record.active) return;
            record.active = false;
            group!.delete(record);
            if (group!.size === 0) listeners.delete(name);
        };
    }

    /** Captures current listeners and returns an isolated delivery callback.
     *
     * @param name - event name
     * @param payload - payload delivered to listeners
     */
    public capture<K extends keyof TEvents>(name: K, payload: TEvents[K]): (() => void) | undefined {
        const group = this.listeners?.get(name);
        if (this.disposed || !group?.size) return undefined;
        const records = Array.from(group);
        return (): void => records.forEach(record => {
            if (this.disposed || !record.active) return;
            try { record.callback(payload as never); } catch (error: unknown) {
                try { reportDeliveryFailure(error); } catch {}
            }
        });
    }

    /** Cancels listeners and makes previously captured callbacks inert. */
    public dispose(): void {
        this.disposed = true;
        this.listeners?.forEach(group => group.forEach(record => { record.active = false; }));
        this.listeners?.clear();
        this.listeners = undefined;
    }
}
