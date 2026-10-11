import assert from 'node:assert/strict';
import {trackRegistrations} from './boundaries.mjs';

/** Public class-root pair control; no parent updates or fabricated load answers. */
export async function checkMultiEntry({React, createRoot, api},
    {strict = false, action, replacement = false} = {}) {
    const requests = [];
    const starts = [];
    const frames = [];
    let renders = 0, rendering = false, duringRender = 0, removals = 0;
    let cache, second;
    const loader = (key, signal) => {
        duringRender += Number(rendering);
        starts.push(key);
        const request = {...Promise.withResolvers(), key, signal};
        requests.push(request);
        if (key === 1 && action && removals === 0) {
            assert.deepEqual(starts, [0, 1], 'remove first synchronously inside second loader start');
            assert.equal(cache.getEntry(0).status, 'pending');
            removals++;
            if (action === 'restore') cache.restore({entries: {}});
            else cache[action](0);
            assert.equal(requests[0].signal.aborted, true, 'first request actually retired');
            assert.equal(second.getEntry(1).status, 'pending', 'second Pending survives first removal');
            assert.equal(signal.aborted, false, 'second request must retain ownership');
            if (replacement) void cache.load(0);
        }
        return request.promise;
    };
    cache = new api.ResourceCache(loader, {ttl: Infinity});
    // restore retires every request in its source, even if a Pending entry is in the snapshot.
    // Use a second public source for that case, not a private runtime patch or fake preserved load.
    second = action === 'restore' ? new api.ResourceCache(loader, {ttl: Infinity}) : cache;
    const registrations = [...new Set([cache, second])].map(trackRegistrations);
    class Pair extends api.AntiHookComponent {
        /** Reads only default data fields, preserving the frozen R39-07 pair contract. */
        render() {
            rendering = true;
            try {
                renders++;
                const first = this.useResource(cache, 0).data;
                const next = this.useResource(second, 1).data;
                const text = `${first?.name ?? '…'}:${next?.name ?? '…'}`;
                frames.push(text);
                return React.createElement('span', null, text);
            } finally { rendering = false; }
        }
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let result;
    try {
        assert.equal(cache.resolve(0).present, false);
        assert.equal(second.resolve(1).present, false);
        const child = React.createElement(Pair);
        await React.act(async () => root.render(strict ? React.createElement(React.StrictMode, null, child) : child));
        assert.equal(container.textContent, '…:…');
        assert.equal(duringRender, 0, 'automatic loads must follow commit');
        if (!action) {
            assert.deepEqual(starts, [0, 1]);
            if (!strict) assert.equal(renders, 1, 'separate absent creations must not render defaults twice');
            result = {multiColdOwnerRenders: strict ? undefined : renders,
                multiColdStarts: starts.length};
            await React.act(async () => requests[0].resolve({name: 'user 0'}));
            assert.equal(container.textContent, 'user 0:…');
            await React.act(async () => requests[1].resolve({name: 'user 1'}));
            assert.equal(container.textContent, 'user 0:user 1');
            assert.deepEqual(starts, [0, 1], 'settlement must not duplicate either loader');
            result.multiColdReadyDOM = Number(container.textContent === 'user 0:user 1');
        } else {
            assert.equal(removals, 1);
            // This assertion intentionally precedes ANY settlement: post-start adoption must
            // not hide missing demand until the retired loader or the other key answers.
            assert.deepEqual(starts, [0, 1, 0], 'exactly one replacement without parent or terminal rescue');
            result = {multiRemovals: removals,
                multiReplacementStarts: starts.filter(key => key === 0).length - 1,
                multiSecondStarts: starts.filter(key => key === 1).length};
            await React.act(async () => requests[0].resolve({name: 'retired'}));
            assert.equal(container.textContent, '…:…', 'retired first answer cannot win');
            await React.act(async () => requests[2].resolve({name: 'ready'}));
            assert.equal(container.textContent, 'ready:…', 'replacement owns first-key delivery');
            await React.act(async () => requests[1].resolve({name: 'user 1'}));
            assert.equal(container.textContent, 'ready:user 1');
            assert.deepEqual(starts, [0, 1, 0], 'no duplicate load after either settlement');
            assert.ok(frames.every(text => !text.includes('retired')), 'retired answer never rendered');
            assert.equal(cache.getEntry(0).data.name, 'ready');
            result.multiReadyDOM = Number(container.textContent === 'ready:user 1');
            result.multiRetiredWinners = frames.filter(text => text.includes('retired')).length;
        }
    } finally {
        await React.act(async () => root.unmount());
        container.remove();
        const released = registrations.map(counter => counter.assertReleased());
        result = {...result,
            multiRegistrationBalance: released.reduce((sum, counter) => sum + counter.balance, 0),
            multiActiveRegistrations: released.reduce((sum, counter) => sum + counter.active, 0)};
    }
    return result;
}
