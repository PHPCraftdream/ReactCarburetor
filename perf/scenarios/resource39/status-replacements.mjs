/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load, loadPath, setupReact} from '../../harness/lib.mjs';

const {AntiHookComponent} = await load();
const {ResourceCache} = await loadPath('Carburetor/Resource/Cache/ResourceCache.mjs');
const {React, flushSync, root, container} = await setupReact();
const drain = async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    flushSync(() => {});
};
const results = {};
for (const method of ['setData', 'restore']) {
    for (const transition of ['retry', 'success']) {
        const pending = [];
        let calls = 0;
        let renders = 0;
        const cache = new ResourceCache(() => {
            calls++;
            const request = Promise.withResolvers();
            pending.push(request);
            return request.promise;
        }, {ttl: Infinity});
        const key = cache.resolve(0).key;
        const entry = {...cache.getEntry(0), status: transition === 'retry' ? 'error' : 'idle',
            updatedAt: transition === 'retry' ? undefined : Date.now()};
        cache.setData({entries: {[key]: entry}});
        class Reader extends AntiHookComponent {
            render() {
                renders++;
                return React.createElement('span', null, this.useResource(cache, 0).data?.name ?? '…');
            }
        }
        flushSync(() => root.render(React.createElement(Reader)));
        await drain();
        const mountCorrect = calls === 0 && renders === 1;
        flushSync(() => cache[method]({entries: {[key]: {...entry,
            status: transition === 'retry' ? 'idle' : 'success'}}}));
        await drain();
        const prefix = method + transition;
        results[prefix + 'Calls'] = calls;
        results[prefix + 'Renders'] = renders;
        const replacementCorrect = transition === 'retry'
            ? calls === 1 && renders === 3 && cache.getEntry(0).status === 'pending'
            : calls === 0 && renders === 2 && cache.getEntry(0).status === 'success';
        if (pending[0]) {
            pending[0].resolve({name: 'loaded'});
            await drain();
        }
        results[prefix + 'Correct'] = mountCorrect && replacementCorrect
            && (transition === 'retry'
                ? calls === 1 && renders === 4 && container.textContent === 'loaded'
                : calls === 0 && container.textContent === '…');
        flushSync(() => root.render(null));
    }
}
flushSync(() => root.unmount());
emit({...results, done: Object.keys(results).filter(key => key.endsWith('Correct')).every(key => results[key])});
