import assert from 'node:assert/strict';
import {trackRegistrations} from './boundaries.mjs';

/**
 * Removes the requested public cache entry at a controlled publication boundary.
 *
 * @param cache - Cache under test.
 * @param action - Public removal operation.
 * @param args - Key to remove for keyed operations.
 */
export function remove(cache, action, args = 'x') {
    if (action === 'restore') cache.restore({entries: {}});
    else if (action === 'forgetAll') cache.forgetAll();
    else cache[action](args);
}

/**
 * Exercises removal before or after the automatic loader starts.
 *
 * @param env - React and public API environment.
 */
export async function checkRemoval(env, {action, kind = 'hook', phase = 'before', strict = false}) {
    const {React, createRoot, api, interop} = env;
    const requests = [];
    const originals = new Set();
    const caught = [];
    const phases = [];
    const cache = new api.ResourceCache(() => {
        const request = Promise.withResolvers();
        requests.push(request);
        return request.promise;
    }, {ttl: Infinity});
    const load = cache.load.bind(cache);
    cache.load = args => {
        const promise = load(args);
        originals.add(promise);
        void promise.catch(error => caught.push(error));
        return promise;
    };
    let removed = false;
    const id = cache.subscribe(() => {
        if (removed || phase === 'after' || cache.getEntry('x').status !== 'pending') return;
        phases.push('pending');
        removed = true;
        remove(cache, action);
        phases.push(cache.resolve('x').present ? 'present' : 'absent');
        if (phase === 'replacement') void cache.load('x');
    }, {reads: new Set([cache.resolve('x').path])});
    const select = view => view.data?.name;
    /** Hook consumer of the selected data field. */
    function Hook() {
        return React.createElement('p', null, interop.useResourceValue(cache, 'x', select) ?? 'loading');
    }
    class Owner extends api.AntiHookComponent {
        /** Class consumer of the public resource view. */
        render() {
            return React.createElement('p', null, this.useResource(cache, 'x').data?.name ?? 'loading');
        }
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const child = React.createElement(kind === 'hook' ? Hook : Owner);
    try {
        assert.equal(cache.resolve('x').present, false);
        await React.act(async () => root.render(strict ? React.createElement(React.StrictMode, null, child) : child));
        assert.equal(container.textContent, 'loading');
        if (phase === 'after') {
            assert.equal(requests.length, 1, 'after-loader control starts original');
            await React.act(async () => remove(cache, action));
        } else {
            assert.equal(removed, true, 'registered public subscriber must remove first Pending before loader');
            if (action !== 'abort') assert.deepEqual(phases, ['pending', 'absent'], 'absent/Pending/absent boundary');
        }
        const expected = phase === 'after' ? 2 : 1;
        assert.equal(requests.length, expected,
            'R42-R01 replacement loader must start without parent rescue');
        if (phase === 'after') {
            await React.act(async () => requests[0].resolve({name: 'retired'}));
            assert.equal(container.textContent, 'loading', 'retired answer must never win');
        }
        await React.act(async () => requests.at(-1).resolve({name: 'ready'}));
        assert.equal(container.textContent, 'ready', 'replacement must deliver final consumer DOM');
        assert.equal(requests.length, expected, 'replacement ownership must not be stolen or duplicated');
        return {originals, caught,
            restoredLoading: Number(requests.length === expected),
            readyDOM: Number(container.textContent === 'ready')};
    } finally {
        await React.act(async () => root.unmount());
        cache.unsubscribe(id);
        container.remove();
    }
}

/**
 * Exercises generation retirement after the original loader has started.
 *
 * @param env - React and public API environment.
 */
export async function checkDisarm(env, {kind = 'hook', mode = 'source', strict = false}) {
    const {React, createRoot, api, interop} = env;
    const requests = [];
    const keys = [];
    const old = new api.ResourceCache(args => {
        keys.push(args);
        const request = Promise.withResolvers();
        requests.push(request);
        return request.promise;
    }, {ttl: Infinity});
    const current = new api.ResourceCache(async () => ({name: 'current'}), {ttl: Infinity});
    await current.load('y');
    /** Hook consumer that can switch its committed source and key. */
    function Hook(props) {
        const value = interop.useResourceValue(props.source, props.args, view => view.data?.name);
        return React.createElement('p', null, value ?? 'loading');
    }
    class Owner extends api.AntiHookComponent {
        /** Class consumer that can switch its committed source and key. */
        render() {
            const value = this.useResource(this.props.source, this.props.args).data?.name;
            return React.createElement('p', null, value ?? 'loading');
        }
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    const tree = (source, args) => {
        const child = React.createElement(kind === 'hook' ? Hook : Owner, {source, args});
        return strict ? React.createElement(React.StrictMode, null, child) : child;
    };
    try {
        await React.act(async () => root.render(tree(old, 'x')));
        assert.deepEqual(keys, ['x'], 'StrictMode must join existing request');
        await React.act(async () => old.invalidate('x'));
        if (mode === 'unmount') await React.act(async () => root.unmount());
        else await React.act(async () => root.render(tree(mode === 'source' ? current : old, 'y')));
        await React.act(async () => requests[0].resolve({name: 'retired'}));
        assert.equal(keys.filter(key => key === 'x').length, 1, 'old generation must not rearm');
        if (mode === 'source') {
            assert.equal(container.textContent, 'current', 'old settlement must not replace current source');
        }
        if (mode === 'args') {
            assert.deepEqual(keys, ['x', 'y']);
            await React.act(async () => requests[1].resolve({name: 'new-key'}));
            assert.equal(container.textContent, 'new-key');
        }
        if (mode === 'unmount') assert.equal(container.textContent, '');
    } finally { await React.act(async () => root.unmount()); }
}

/**
 * Exercises refresh cancellation, explicit rearming and ordinary failure guards.
 *
 * @param env - React and public API environment.
 * @param kind - Hook or class consumer.
 * @param action - Public removal operation.
 */
export async function checkRefresh(env, kind = 'hook', action = 'abort') {
    const {React, createRoot, api, interop} = env;
    const requests = [];
    const cache = new api.ResourceCache(() => {
        const request = Promise.withResolvers();
        requests.push(request);
        return request.promise;
    }, {ttl: Infinity});
    const initial = cache.load('x');
    requests[0].resolve({name: 'retained'});
    await initial;
    const select = view => view.error ?? view.data?.name ?? 'loading';
    /** Hook consumer of refresh status and retained data. */
    function Hook() { return React.createElement('p', null, interop.useResourceValue(cache, 'x', select)); }
    class Owner extends api.AntiHookComponent {
        /** Class consumer of refresh status and retained data. */
        render() {
            const view = this.useResource(cache, 'x');
            return React.createElement('p', null, view.error ?? view.data?.name ?? 'loading');
        }
    }
    let armed = true;
    const id = cache.subscribe(() => {
        if (!armed || !cache.getEntry('x').refreshing) return;
        armed = false;
        remove(cache, action);
    }, {reads: new Set([cache.resolve('x').path])});
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
        await React.act(async () => root.render(React.createElement(kind === 'hook' ? Hook : Owner)));
        await React.act(async () => cache.invalidate('x'));
        if (action === 'abort') {
            assert.equal(container.textContent, 'retained', 'abort refresh must retain Success');
        }
        assert.equal(requests.length, 2, 'explicit new demand or removed Success must load once');
        await React.act(async () => cache.invalidate('x'));
        await React.act(async () => requests[1].resolve({name: 'ready'}));
        assert.equal(requests.length, 3, 'invalidation during load must rearm after successful settlement');
        await React.act(async () => requests[2].reject(new Error('offline')));
        assert.equal(cache.getEntry('x').failed, true);
        assert.equal(container.textContent, 'offline');
        await React.act(async () => root.render(React.createElement(kind === 'hook' ? Hook : Owner, {tick: 1})));
        assert.equal(requests.length, 3, 'ordinary failed loader must not automatically retry');
        await React.act(async () => cache.invalidate('x'));
        assert.equal(requests.length, 4, 'failed request explicitly rearms once');
        await React.act(async () => requests[3].resolve({name: 'recovered'}));
        assert.equal(container.textContent, 'recovered');
    } finally { await React.act(async () => root.unmount()); cache.unsubscribe(id); }
}

/** Checks warm selection, child, loader and subscription reuse. */
export async function checkWarm(env) {
    const {React, createRoot, api, interop} = env;
    let loads = 0, selections = 0, children = 0;
    const cache = new api.ResourceCache(async () => { loads++; return {name: 'ready'}; }, {ttl: Infinity});
    const registrations = trackRegistrations(cache);
    await cache.load('x');
    const select = view => { selections++; return view.data; };
    const Child = React.memo(({value}) => { children++; return React.createElement('p', null, value.name); });
    /** Hook consumer with a stable selector and memo child. */
    function Hook() { return React.createElement(Child, {value: interop.useResourceValue(cache, 'x', select)}); }
    const container = document.createElement('div');
    const root = createRoot(container);
    let result;
    try {
        await React.act(async () => root.render(React.createElement(Hook, {tick: 0})));
        const before = {selections, children, loads, ...registrations.snapshot()};
        for (let tick = 1; tick <= 4; tick++) {
            await React.act(async () => root.render(React.createElement(Hook, {tick})));
        }
        assert.equal(selections - before.selections, 0, 'warm stable selector must not reevaluate');
        assert.equal(children - before.children, 0, 'warm stable memo child must not rerender');
        assert.equal(loads - before.loads, 0, 'warm Success must not reload');
        const after = registrations.snapshot();
        assert.equal(after.adds - before.adds, 0, 'warm parent renders must not add subscriptions');
        assert.equal(after.removes - before.removes, 0, 'warm parent renders must not remove subscriptions');
        assert.equal(container.textContent, 'ready');
        result = {warmSelectorCalls: selections - before.selections,
            warmChildRenders: children - before.children, warmLoads: loads - before.loads,
            warmRegistrationAdds: after.adds - before.adds,
            warmRegistrationRemoves: after.removes - before.removes};
    } finally {
        await React.act(async () => root.unmount());
        const released = registrations.assertReleased();
        result = {...result, registrationBalance: released.balance, activeRegistrations: released.active};
    }
    return result;
}
