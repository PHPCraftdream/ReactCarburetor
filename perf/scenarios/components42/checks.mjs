import assert from 'node:assert/strict';
import {trackRegistrations} from '../resource42/boundaries.mjs';

/**
 * Exercises committed ownership while a speculative lane is suspended.
 *
 * @param options - Suspension, cancellation, source-swap and selector variants.
 */
export async function checkOwnership({React, createRoot, api, interop}, options) {
    const {self = true, strict = false, stateful = false, resume = false, swap = false, kind = 'selected'} = options;
    const {AntiHookComponent, Carburetor} = api;
    class Store extends Carburetor {
        /** Installed read sets for the committed owner. */
        active = new Map();
        /** Captured callbacks used to probe late delivery after release. */
        callbacks = [];
        /** Writes a public store update. */
        edit(fn) { this.update(fn); }
        /**
         * Records installed demand.
         *
         * @param fn - Delivery callback.
         * @param opts - Subscription read set.
         */
        subscribe(fn, opts) {
            const id = super.subscribe(fn, opts);
            this.active.set(id, [...opts.reads]);
            this.callbacks.push(fn);
            return id;
        }
        /** Releases the recorded committed demand. */
        unsubscribe(id) { this.active.delete(id); super.unsubscribe(id); }
    }
    const equal = options.equal ?? false;
    const a = new Store({a: 1, b: equal ? 1 : 2});
    const b = swap ? new Store({a: 10, b: equal ? 1 : 2}) : a;
    let restoredDeliveries = 0;
    const registrations = [...new Set([a, b])].map(trackRegistrations);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const pending = Promise.withResolvers();
    let released = false;
    let instance;
    /** Suspends the child without committing its speculative parent. */
    function Gate() { if (!released) throw pending.promise; return null; }
    const output = (config, value) => {
        if (config.block && self && !released) throw pending.promise;
        return React.createElement(React.Fragment, null,
            React.createElement('p', null, config.branch + ':' + value),
            config.block && !self ? React.createElement(Gate) : null);
    };
    class Owner extends AntiHookComponent {
        /** Stateful lane configuration for setState transition variants. */
        state = {branch: 'a', block: false, source: a};
        /** Selects the branch requested by this render attempt. */
        pick = this.connectSelection(() => (stateful ? this.state : this.props).source,
            data => data[(stateful ? this.state : this.props).branch]);
        /** Renders the selected attempt, which may suspend before commit. */
        render() {
            const config = stateful ? this.state : this.props;
            const value = kind === 'raw' ? this.useCarburetor(config.source)[config.branch] : this.pick();
            return output(config, value);
        }
    }
    /** Hook control for committed subscription ownership. */
    function Hook(config) {
        return output(config, interop.useCarburetorValue(config.source, data => data[config.branch]));
    }
    const tree = config => {
        const child = React.createElement(kind === 'hook' ? Hook : Owner,
            {...config, ref: kind === 'hook' ? undefined : value => { if (value) instance = value; }});
        const boundary = React.createElement(React.Suspense, {fallback: 'fallback'}, child);
        return strict ? React.createElement(React.StrictMode, null, boundary) : boundary;
    };
    const render = config => stateful ? instance.setState(config) : root.render(tree(config));
    const committed = {branch: 'a', block: false, source: a};
    const speculative = {branch: 'b', block: true, source: b};
    try {
        await React.act(async () => root.render(tree(committed)));
        assert.equal(container.textContent, 'a:1', 'mount DOM');
        await React.act(async () => React.startTransition(() => render(speculative)));
        assert.equal(container.textContent, 'a:1', 'transition must retain committed DOM');
        assert.deepEqual([...a.active.values()], [['a']], 'speculative reads must not be installed');
        await React.act(async () => a.edit(data => { data.a = 2; }));
        assert.equal(container.textContent, 'a:2', 'R42-A01 visible committed a delivery was lost');
        restoredDeliveries++;
        assert.deepEqual([...a.active.values()], [['a']], 'R42-A01 notification migrated speculative reads');
        if (resume) {
            await React.act(async () => a.edit(data => { data.a = 3; }));
            assert.equal(container.textContent, 'a:3', 'second committed delivery');
            restoredDeliveries++;
            await React.act(async () => { released = true; pending.resolve(); });
            assert.equal(container.textContent, equal ? 'b:1' : 'b:2', 'successful transition must commit b');
            await React.act(async () => a.edit(data => { data.a = 4; }));
            assert.equal(container.textContent, equal ? 'b:1' : 'b:2', 'retired branch must be silent');
            await React.act(async () => b.edit(data => { data.b = 5; }));
            assert.equal(container.textContent, 'b:5', 'new committed branch delivery');
        } else {
            await React.act(async () => render(committed));
            await React.act(async () => a.edit(data => { data.a = 3; }));
            assert.equal(container.textContent, 'a:3', 'cancel then a=3 must retain committed demand');
            restoredDeliveries++;
            await React.act(async () => { released = true; pending.resolve(); });
            assert.equal(container.textContent, 'a:3', 'late suspended completion must not revive b');
        }
        const late = [...a.callbacks, ...(swap ? b.callbacks : [])];
        await React.act(async () => root.unmount());
        await React.act(async () => { for (const callback of late) callback(); });
        assert.equal(a.active.size + (swap ? b.active.size : 0), 0, 'late callbacks must not reinstall subscriptions');
        const registrationResults = registrations.map(counter => counter.assertReleased());
        return {restoredDeliveries, releasedOwners: a.active.size + (swap ? b.active.size : 0),
            registrationBalance: registrationResults.reduce((sum, count) => sum + count.balance, 0)};
    } finally {
        await React.act(async () => root.unmount());
        container.remove();
    }
}

/**
 * Checks committed equal migration and warm selection reuse without subscription churn.
 *
 * @param kind - Public selection consumer to exercise.
 */
export async function checkCommittedControl({React, createRoot, api, interop}, kind = 'selected') {
    class Store extends api.Carburetor {
        /** Number of subscription installations. */
        adds = 0;
        /** Number of subscription releases. */
        removes = 0;
        /** Writes the controlled branch mutation. */
        edit(fn) { this.update(fn); }
        /**
         * Counts public subscription installations.
         *
         * @param fn - Delivery callback.
         * @param opts - Subscription read set.
         */
        subscribe(fn, opts) { this.adds++; return super.subscribe(fn, opts); }
        /** Counts public subscription releases. */
        unsubscribe(id) { this.removes++; super.unsubscribe(id); }
    }
    const store = new Store({left: 1, right: 1, useLeft: true, unused: 0});
    const registrations = trackRegistrations(store);
    let result;
    let owners = 0, children = 0, selections = 0;
    const select = data => { selections++; return {n: data.useLeft ? data.left : data.right}; };
    const Child = React.memo(({value}) => { children++; return React.createElement('p', null, value.n); });
    class Owner extends api.AntiHookComponent {
        /** Stable class selector used by unrelated warm parent renders. */
        pick = this.connectSelection(() => store, select);
        /** Renders the detached selection into a memo child. */
        render() { owners++; return React.createElement(Child, {value: this.pick()}); }
    }
    /** Hook control using the same stable selector and memo child. */
    function Hook() {
        owners++;
        return React.createElement(Child, {value: interop.useCarburetorValue(store, select)});
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    const tree = tick => React.createElement(kind === 'hook' ? Hook : Owner, {tick});
    try {
        await React.act(async () => root.render(tree(0)));
        const beforeWarm = {children, selections, adds: store.adds, removes: store.removes};
        for (let tick = 1; tick <= 4; tick++) await React.act(async () => root.render(tree(tick)));
        assert.equal(children - beforeWarm.children, 0, 'warm memo consumer must reuse detached selection');
        if (kind === 'hook') {
            assert.equal(selections - beforeWarm.selections, 0, 'warm stable hook selector must be reused');
        }
        assert.equal(store.adds - beforeWarm.adds, 0, 'warm parent renders must not add subscriptions');
        assert.equal(store.removes - beforeWarm.removes, 0, 'warm parent renders must not remove subscriptions');
        const warm = {warmChildRenders: children - beforeWarm.children,
            warmSelectorCalls: selections - beforeWarm.selections,
            warmRegistrationAdds: store.adds - beforeWarm.adds,
            warmRegistrationRemoves: store.removes - beforeWarm.removes};
        const before = {owners, children};
        await React.act(async () => store.edit(data => { data.useLeft = false; }));
        await React.act(async () => store.edit(data => { data.left = 7; data.unused++; }));
        assert.equal(owners - before.owners, 0, 'committed equal migration must avoid owner renders');
        assert.equal(children - before.children, 0, 'committed equal migration must avoid child renders');
        result = {...warm, equalOwnerRenders: owners - before.owners, equalChildRenders: children - before.children};
        await React.act(async () => store.edit(data => { data.right = 3; }));
        assert.equal(container.textContent, '3', 'migrated branch must deliver');
    } finally {
        await React.act(async () => root.unmount());
        const released = registrations.assertReleased();
        result = {...result, releasedOwners: released.active, registrationBalance: released.balance};
        container.remove();
    }
    return result;
}

/** Checks drift reconciliation for a child layout write before owner commit. */
export async function checkWriteGap({React, createRoot, api}) {
    class Store extends api.Carburetor {
        /** Writes the controlled layout-effect mutation. */
        edit(fn) { this.update(fn); }
    }
    const store = new Store({n: 1});
    /** Writes after render but before the parent owner commits. */
    function Writer() {
        React.useLayoutEffect(() => { store.edit(data => { data.n = 2; }); }, []);
        return null;
    }
    class Owner extends api.AntiHookComponent {
        /** Tracks the field written by the child layout effect. */
        pick = this.connectSelection(() => store, data => data.n);
        /** Renders both the field consumer and layout writer. */
        render() { return React.createElement(React.Fragment, null,
            React.createElement('p', null, this.pick()), React.createElement(Writer)); }
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
        await React.act(async () => root.render(React.createElement(Owner)));
        assert.equal(container.textContent, '2', 'render-to-commit write must be caught by drift reconciliation');
    } finally { await React.act(async () => root.unmount()); }
}
