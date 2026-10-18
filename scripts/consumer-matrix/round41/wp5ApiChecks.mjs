import assert from 'node:assert/strict';

/** Exercise the widened public API on a built package's exports.
 *
 * @param runtime - runtime exports from one or more compatible module formats.
 * @param baseline - collect results without asserting, for inventory runs.
 */
export const runWp5ApiChecks = (runtime, {baseline = false} = {}) => {
    const {Carburetor, carburetorToken, CarburetorScope, AntiHookComponent,
        UpdateThrottle, ComponentUpdateThrottle} = runtime;
    const results = [];
    // Helpers are declared inside the check function so the injectable source of
    // `runWp5ApiChecks` is self-contained: the update overload and the function-keyed
    // effect each use the function itself as a stable key.
    const applyRow = (draft, id, title) => {
        draft.id = id;
        draft.title = title;
    };
    const gatherEffect = (log) => () => {
        log.ran++;
        return () => { log.cleaned++; };
    };
    const check = (kind, observed, valid) => {
        results.push({kind, observed, valid});
        if (!baseline) assert.equal(valid, true, `${kind}: ${JSON.stringify(observed)}`);
    };
    {
        // update(mutate, ...args): a module-level mutator receives the draft plus the
        // forwarded arguments, the write lands in the data, and subscribers are notified.
        const store = new Carburetor({id: 0, title: ''});
        const events = [];
        const stop = store.watch(view => ({id: view.id, title: view.title}),
            value => events.push(value));
        store.update(applyRow, 7, 'answer');
        stop();
        const data = store.getData();
        check('update-args', {id: data.id, title: data.title, events},
            data.id === 7 && data.title === 'answer' && events.length === 1
            && events[0].id === 7 && events[0].title === 'answer');
    }
    {
        // Lazy hydrate without a token list: the payload is kept, the first get() of a token
        // whose key is present restores its state, and a payload key no token claims is
        // simply unused — not an error, and never applied to anything. Unclaimed keys in
        // lazy mode are deliberately not reported as dev complaints; that is pinned here.
        const counter = carburetorToken(() => new Carburetor({count: 0}), 'wp5-counter');
        const orphan = carburetorToken(() => new Carburetor({count: 0}), 'wp5-orphan');
        const scope = new CarburetorScope();
        const complaints = [];
        const originalConsoleError = console.error;
        console.error = (...args) => { complaints.push(args.map(String).join(' ')); };
        try {
            scope.hydrate({['wp5-counter']: {count: 41}, ['wp5-unclaimed']: {count: 99}});
            var restored = scope.get(counter).getData().count;
            var fresh = scope.get(orphan).getData().count;
        } finally {
            console.error = originalConsoleError;
        }
        check('lazy-hydrate', {restored, fresh, hydrated: scope.has(counter), reports: complaints.length},
            restored === 41 && fresh === 0 && scope.has(counter)
            && complaints.length === 0);
    }
    {
        // Function-keyed useEffect: the harness has no React renderer for these cells, but the
        // component's public lifecycle entry points are plain methods, so mount and unmount
        // can be driven by hand: componentDidMount runs the effect, unchanged deps must not
        // re-run it, and componentWillUnmount runs its cleanup exactly once.
        const log = {ran: 0, cleaned: 0};
        const effect = gatherEffect(log);
        class EffectReader extends AntiHookComponent {
            /** Declares one function-keyed effect with stable deps. */
            useEffects() { this.useEffect(effect, []); }
            /** This check needs no rendered markup. */
            render() { return null; }
        }
        const reader = new EffectReader({});
        reader.componentDidMount();
        reader.componentDidMount();
        reader.componentWillUnmount();
        check('function-effect', {ran: log.ran, cleaned: log.cleaned},
            log.ran === 1 && log.cleaned === 1);
    }
    {
        // new Carburetor(data, {scheduler}): the options-object form must resolve the
        // scheduler inside it; a write through update is handed to schedule exactly once,
        // and flushing the scheduled callback publishes the already-applied write. The
        // scheduler is only invoked for matched subscribers, so a subscriber is required.
        const jobs = new Map();
        let scheduled = 0;
        let delivered = 0;
        const scheduler = {
            schedule: (key, callback) => { scheduled++; jobs.set(key, callback); },
            cancel: (key) => jobs.delete(key),
        };
        const store = new Carburetor({count: 0}, {scheduler});
        const subscriptionId = store.subscribe(() => { delivered++; });
        store.update(draft => { draft.count = 1; });
        const pending = [...jobs.values()];
        jobs.clear();
        pending.forEach(callback => callback());
        store.unsubscribe(subscriptionId);
        check('scheduler-options', {scheduled, delivered, count: store.getData().count},
            scheduled === 1 && delivered === 1 && store.getData().count === 1);
    }
    {
        // UpdateThrottle is present at runtime and is the very same class as the long name.
        const same = UpdateThrottle === ComponentUpdateThrottle;
        check('update-throttle-alias', {same, isClass: typeof UpdateThrottle === 'function'},
            same && typeof UpdateThrottle === 'function');
    }
    return results;
};
