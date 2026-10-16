import assert from 'node:assert/strict';

/** Counts public registrations by returned ID, including same-ID replacement retirement. */
export function trackRegistrations(source) {
    const active = new Set();
    const counters = {adds: 0, replacements: 0, removes: 0, unknownRemoves: 0};
    const subscribe = source.subscribe.bind(source);
    const unsubscribe = source.unsubscribe.bind(source);
    source.subscribe = (...args) => {
        const id = subscribe(...args);
        counters.adds++;
        if (active.has(id)) counters.replacements++;
        active.add(id);
        return id;
    };
    source.unsubscribe = id => {
        unsubscribe(id);
        if (active.delete(id)) counters.removes++;
        else counters.unknownRemoves++;
    };
    return {
        snapshot: () => ({...counters, active: active.size,
            balance: counters.adds - counters.replacements - counters.removes}),
        assertReleased() {
            const result = this.snapshot();
            assert.equal(result.active, 0, 'teardown must release every actual registration ID');
            assert.equal(result.balance, 0, 'installations must balance replacements and releases');
            assert.equal(result.unknownRemoves, 0, 'teardown must not release an unregistered ID');
            return result;
        },
    };
}

/** Exercises a real React error boundary for a throwing resource selector. */
export async function checkSelectorBoundary({React, createRoot, api, interop}) {
    const cache = new api.ResourceCache(async () => ({name: 'ready'}), {ttl: Infinity});
    await cache.load('x');
    const expected = new Error('selector failed');
    const caught = [];
    const componentStacks = [];
    const select = () => { throw expected; };
    /** Hook whose selector fails during render. */
    function Hook() {
        return React.createElement('p', null, interop.useResourceValue(cache, ['x'], select));
    }
    class Boundary extends React.Component {
        /** Whether React has captured the selector error. */
        state = {failed: false};
        /** Selects the fallback after React captures an error. */
        static getDerivedStateFromError() { return {failed: true}; }
        /** Retains the caught error and its public component stack.
         *
         * @param error - The caught selector error.
         * @param info - React's boundary metadata.
         */
        componentDidCatch(error, info) {
            caught.push(error);
            if (info.componentStack) componentStacks.push(info.componentStack);
        }
        /** Renders the consumer or the committed error fallback. */
        render() { return this.state.failed ? 'selector-error' : this.props.children; }
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    const diagnostics = [];
    const originalError = console.error;
    console.error = (...args) => { diagnostics.push(args); };
    try {
        await React.act(async () => root.render(React.createElement(Boundary, null, React.createElement(Hook))));
        assert.equal(container.textContent, 'selector-error');
        assert.deepEqual(caught, [expected], 'selector errors must reach the real boundary unchanged');
    } finally {
        try { await React.act(async () => root.unmount()); }
        finally { console.error = originalError; }
    }
    const unexpected = diagnostics.filter(args => !args.some(value => value === expected ||
        (typeof value === 'string' && (value === expected.stack ||
            componentStacks.some(stack => value.includes(stack))))));
    for (const args of unexpected) originalError(...args);
    assert.equal(unexpected.length, 0, 'unexpected React diagnostics must not be silenced');
}

/** Exercises swap or unmount before a superseded automatic load can start its loader. */
export async function checkPreloaderDisarm({React, createRoot, api, interop}, {kind, mode, strict}) {
    const keys = [];
    let seeded = false;
    const old = new api.ResourceCache(async args => {
        if (seeded) keys.push(args);
        return {name: 'obsolete'};
    }, {ttl: Infinity});
    await old.load('x');
    seeded = true;
    const current = new api.ResourceCache(async () => ({name: 'current'}), {ttl: Infinity});
    const registrations = [old, current].map(trackRegistrations);
    await current.load('y');
    const container = document.createElement('div');
    const root = createRoot(container);
    /** Hook consumer whose generation is retired during Pending publication. */
    function Hook(props) {
        const value = interop.useResourceValue(props.source, [props.args], view => view.data?.name);
        return React.createElement('p', null, value ?? 'loading');
    }
    class Owner extends api.AntiHookComponent {
        /** Class consumer whose generation is retired during Pending publication. */
        render() {
            return React.createElement('p', null, this.useResource(this.props.source, this.props.args).data?.name);
        }
    }
    let retired = false;
    let retirementNotify;
    const subscribeRetirement = notify => {
        retirementNotify = notify;
        return () => { retirementNotify = undefined; };
    };
    const retirementSnapshot = () => retired;
    const retire = () => { retired = true; retirementNotify?.(); };
    let committedRetirement = false;
    const terminalCommits = [];
    const load = old.load.bind(old);
    old.load = args => {
        const promise = load(args);
        if (args === 'x') {
            void promise.then(() => terminalCommits.push(committedRetirement),
                () => terminalCommits.push(committedRetirement));
        }
        return promise;
    };
    /** Owns retirement as a committed React update, after mount replay has completed. */
    function Parent() {
        const retired = React.useSyncExternalStore(subscribeRetirement, retirementSnapshot, retirementSnapshot);
        React.useLayoutEffect(() => {
            if (retired) committedRetirement = true;
        }, [retired]);
        return retired
            ? mode === 'unmount' ? null : React.createElement(kind === 'hook' ? Hook : Owner,
                {source: mode === 'source' ? current : old, args: 'y'})
            : React.createElement(kind === 'hook' ? Hook : Owner, {source: old, args: 'x'});
    }
    const tree = () => strict
        ? React.createElement(React.StrictMode, null, React.createElement(Parent))
        : React.createElement(Parent);
    let removed = false;
    let retirements = 0;
    let result;
    const id = old.subscribe(() => {
        if (removed || old.getEntry('x').status !== 'pending') return;
        removed = true;
        retirements++;
        retire();
        old.forget('x');
    }, {reads: new Set([old.resolve('x').path])});
    try {
        await React.act(async () => root.render(tree()));
        assert.equal(removed, false, 'fresh mount and Strict replay must complete before retirement event');
        assert.deepEqual(keys, [], 'fresh mount must not load');
        await React.act(async () => old.forget('x'));
        assert.equal(committedRetirement, true, 'swap/removal must actually commit before terminal demand drains');
        assert.deepEqual(
            terminalCommits, [true], 'obsolete terminal continuation must follow actual retirement commit');
        assert.equal(removed, true, 'retirement must occur during pre-loader Pending publication');
        assert.equal(old.resolve('x').present, false, 'retired x demand must not rearm');
        assert.equal(keys.filter(key => key === 'x').length, 0, 'retired x must never start its loader');
        assert.deepEqual(keys, mode === 'args' ? ['y'] : [], 'only the newly committed key may start a loader');
        result = {preloaderRetirements: retirements, retiredLoads: keys.filter(key => key === 'x').length};
        assert.equal(container.textContent, mode === 'unmount' ? '' : mode === 'source' ? 'current' : 'obsolete');
    } finally {
        await React.act(async () => root.unmount());
        old.unsubscribe(id);
        const released = registrations.map(counter => counter.assertReleased());
        result = {...result,
            registrationBalance: released.reduce((sum, count) => sum + count.balance, 0),
            activeRegistrations: released.reduce((sum, count) => sum + count.active, 0)};
    }
    return result;
}
