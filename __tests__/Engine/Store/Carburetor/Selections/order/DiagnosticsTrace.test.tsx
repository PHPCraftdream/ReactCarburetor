import {AntiHookComponent, Carburetor, diagnostics, ComponentUpdateThrottle} from '@/Carburetor';
import {act} from 'react';
import {render} from '@testing-library/react';

class ManualTraceThrottle extends ComponentUpdateThrottle {
    constructor() { super(60_000); }
    public flush(): void { this.letsUpdate(); }
}

describe('global diagnostics tracing', () => {
    test('emits an immutable trace at callback delivery', () => {
        const store = new Carburetor({a: 0, b: 0});
        const events: unknown[] = [];
        const stop = diagnostics.traceUpdates(event => events.push(event));
        store.subscribe(() => undefined, {id: 'alpha', reads: ['a']});
        store.setData({a: 1, b: 0});
        stop();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject(
            {subscriber: 'alpha', store: store.getUID(), paths: ['a'], version: 1, callback: 'invoked'}
        );
        expect(Object.isFrozen(events[0])).toBe(true);
        expect(Object.isFrozen((events[0] as {paths: unknown}).paths)).toBe(true);
        store.unsubscribe('alpha');
    });

    test('coalesces matching paths to the latest version before throttled delivery', () => {
        const scheduler = new ManualTraceThrottle();
        const store = new Carburetor({a: 0, b: 0, other: 0}, scheduler);
        const events: unknown[] = [];
        const stop = diagnostics.traceUpdates(event => events.push(event));
        store.subscribe(() => undefined, {id: 'coalesced', reads: ['a', 'b']});
        store.setData({a: 1, b: 0, other: 0});
        store.setData({a: 1, b: 1, other: 0});
        scheduler.flush();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({paths: ['a', 'b'], version: 2});
        stop();
        store.unsubscribe('coalesced');
    });

    test('excludes unmatched paths and skips pending delivery after unsubscribe', () => {
        const scheduler = new ManualTraceThrottle();
        const store = new Carburetor({a: 0, other: 0}, scheduler);
        const events: unknown[] = [];
        const stop = diagnostics.traceUpdates(event => events.push(event));
        store.subscribe(() => undefined, {id: 'pending', reads: ['a']});
        store.setData({a: 1, other: 0});
        store.setData({a: 1, other: 1});
        store.unsubscribe('pending');
        scheduler.flush();
        expect(events).toEqual([]);
        stop();
    });

    test('drops a pending trace from an ended listener session', () => {
        const scheduler = new ManualTraceThrottle();
        const store = new Carburetor({a: 0}, scheduler);
        const events: unknown[] = [];
        const stopFirst = diagnostics.traceUpdates(event => events.push(event));
        store.subscribe(() => undefined, {id: 'epoch', reads: ['a']});
        store.setData({a: 1});
        stopFirst();
        store.setData({a: 2});
        scheduler.flush();
        const stopSecond = diagnostics.traceUpdates(event => events.push(event));
        store.setData({a: 3});
        scheduler.flush();
        stopSecond();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({paths: ['a'], version: 3});
        store.unsubscribe('epoch');
    });

    test('includes only matching write paths and invokes callback despite throwing listeners', () => {
        const store = new Carburetor({a: 0, b: 0, c: 0});
        let called = 0;
        const events: unknown[] = [];
        const stopThrowing = diagnostics.traceUpdates(() => { throw new Error('trace'); });
        const stop = diagnostics.traceUpdates(event => events.push(event));
        store.subscribe(() => { called++; }, {id: 'exact', reads: ['a']});
        store.subscribe(() => undefined, {id: 'bc', reads: ['b', 'c']});
        store.setData({a: 1, b: 1, c: 0});
        expect(events.filter(event => (event as {subscriber: string}).subscriber === 'exact')).toHaveLength(1);
        expect(events.find(event => (event as {subscriber: string}).subscriber === 'exact'))
            .toMatchObject({subscriber: 'exact', paths: ['a']});
        expect(called).toBe(1);
        stop();
        stopThrowing();
        store.unsubscribe('exact');
        store.unsubscribe('bc');
    });

    test('disposal after synchronous callback delivery leaves its trace intact', () => {
        const store = new Carburetor({a: 0});
        const events: unknown[] = [];
        const stop = diagnostics.traceUpdates(event => events.push(event));
        store.subscribe(() => undefined, {id: 'sync', reads: ['a']});
        store.setData({a: 1});
        stop();
        expect(events).toHaveLength(1);
        store.unsubscribe('sync');
    });

    test('labels a registered component callback trace with the component name', () => {
        const store = new Carburetor({a: 0});
        const events: unknown[] = [];
        const stop = diagnostics.traceUpdates(event => events.push(event));
        const component = {label: 'ConnectedWidget'};
        const callback = (): void => undefined;
        diagnostics.registerComponent(component, 'ConnectedWidget', callback);
        store.subscribe(callback, {id: 'connected', reads: ['a']});
        store.setData({a: 1});
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({subscriber: 'ConnectedWidget'});
        stop();
        store.unsubscribe('connected');
    });

    test('keeps registrations independent and preserves pending traces across one disposal', () => {
        const scheduler = new ManualTraceThrottle();
        const store = new Carburetor({a: 0}, scheduler);
        const events: unknown[] = [];
        const listener = (event: unknown): void => events.push(event);
        const stopFirst = diagnostics.traceUpdates(listener);
        const stopSecond = diagnostics.traceUpdates(listener);
        store.subscribe(() => undefined, {id: 'independent', reads: ['a']});
        store.setData({a: 1});
        stopFirst();
        scheduler.flush();
        stopSecond();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({paths: ['a'], version: 1});
        store.unsubscribe('independent');
    });

    test('a registration added while a trace is pending keeps that trace', () => {
        const scheduler = new ManualTraceThrottle();
        const store = new Carburetor({a: 0}, scheduler);
        const first: unknown[] = [];
        const second: unknown[] = [];
        const stopFirst = diagnostics.traceUpdates(event => first.push(event));
        store.subscribe(() => undefined, {id: 'pending', reads: ['a']});
        store.setData({a: 1});
        const stopSecond = diagnostics.traceUpdates(event => second.push(event));
        scheduler.flush();
        stopFirst();
        stopSecond();
        expect(first).toHaveLength(1);
        expect(second).toHaveLength(1);
        store.unsubscribe('pending');
    });

    test('labels a component callback trace with its display name and skips unwoken ones', () => {
        const store = new Carburetor({a: 0, other: 0});
        const events: unknown[] = [];
        const stop = diagnostics.traceUpdates(event => events.push(event));
        class TracedWidget extends AntiHookComponent {
            public static displayName = 'TracedWidget';
            render() { const data = this.useCarburetor(store); return <span>{data.a}</span>; }
        }
        const view = render(<TracedWidget/>);
        act(() => { store.setData({a: 1, other: 0}); });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({subscriber: 'TracedWidget', store: store.getUID(), paths: ['a']});
        stop();
        view.unmount();
    });

    test('emits no trace for a subscriber the write did not wake', () => {
        const store = new Carburetor({a: 0, other: 0});
        const events: unknown[] = [];
        const stop = diagnostics.traceUpdates(event => events.push(event));
        store.subscribe(() => undefined, {id: 'idle', reads: ['a']});
        store.setData({a: 0, other: 1});
        expect(events).toHaveLength(0);
        stop();
        store.unsubscribe('idle');
    });

    test('threshold is off (Infinity) by default and rejects invalid values', () => {
        expect(diagnostics.getWideReadThreshold()).toBe(Number.POSITIVE_INFINITY);
        expect(() => diagnostics.setWideReadThreshold(-1)).toThrow();
        expect(() => diagnostics.setWideReadThreshold(Number.NaN)).toThrow();
        expect(() => diagnostics.setWideReadThreshold(Number.POSITIVE_INFINITY)).not.toThrow();
    });

    test('an Infinity threshold silences a wide component read', () => {
        const data: Record<string, number> = {};
        for (let i = 1; i <= 120; i++) data[`f${i}`] = 0;
        const store = new Carburetor(data);
        const errors: unknown[] = [];
        const original = console.error;
        class Wide extends AntiHookComponent {
            render() { const d = this.useCarburetor(store); return <span>{Object.values(d).length}</span>; }
        }
        diagnostics.setWideReadThreshold(Number.POSITIVE_INFINITY);
        console.error = (...args: unknown[]) => errors.push(args);
        try {
            const view = render(<Wide/>);
            act(() => { for (let i = 1; i <= 120; i++) data[`f${i}`] = 1; store.setData({...data}); });
            view.unmount();
        } finally {
            console.error = original;
            diagnostics.setWideReadThreshold(Infinity);
        }
        expect(errors).toHaveLength(0);
    });
});
