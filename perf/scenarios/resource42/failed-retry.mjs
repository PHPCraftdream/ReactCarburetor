import assert from 'node:assert/strict';
import {remove} from './checks.mjs';

/**
 * Checks explicit retry ownership after an ordinary failed request.
 *
 * @param env - React and public API environment.
 * @param kind - Hook or class consumer.
 * @param action - Public removal operation during retry publication.
 */
export async function checkFailedRetry(env, kind, action) {
    const {React, createRoot, api, interop} = env;
    const requests = [];
    const cache = new api.ResourceCache(() => {
        const request = Promise.withResolvers();
        requests.push(request);
        return request.promise;
    }, {ttl: Infinity});
    /** Hook consumer of failure and recovery data. */
    function Hook() {
        const value = interop.useResourceValue(cache, ['x'], view => view.error ?? view.data?.name ?? 'loading');
        return React.createElement('p', null, value);
    }
    class Owner extends api.AntiHookComponent {
        /** Class consumer of failure and recovery data. */
        render() {
            const view = this.useResource(cache, 'x');
            return React.createElement('p', null, view.error ?? view.data?.name ?? 'loading');
        }
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    const tree = tick => React.createElement(kind === 'hook' ? Hook : Owner, {tick});
    let id;
    try {
        await React.act(async () => root.render(tree(0)));
        await React.act(async () => requests[0].reject(new Error('offline')));
        assert.equal(container.textContent, 'offline');
        await React.act(async () => root.render(tree(1)));
        assert.equal(requests.length, 1, 'ordinary failure cannot retry itself');
        let armed = true;
        id = cache.subscribe(() => {
            if (!armed || cache.getEntry('x').status !== 'pending') return;
            armed = false;
            remove(cache, action);
        }, {reads: new Set([cache.resolve('x').path])});
        await React.act(async () => cache.invalidate('x'));
        if (action === 'abort') {
            assert.equal(requests.length, 1, 'aborted failed retry restores failed guard');
            assert.equal(cache.getEntry('x').failed, true);
            await React.act(async () => root.render(tree(2)));
            assert.equal(requests.length, 1, 'parent render cannot bypass restored failed guard');
            await React.act(async () => cache.invalidate('x'));
        }
        assert.equal(requests.length, 2, 'removed failed entry or explicit rearm must start one replacement');
        await React.act(async () => requests[1].resolve({name: 'recovered'}));
        assert.equal(container.textContent, 'recovered');
    } finally {
        await React.act(async () => root.unmount());
        if (id) cache.unsubscribe(id);
    }
}
