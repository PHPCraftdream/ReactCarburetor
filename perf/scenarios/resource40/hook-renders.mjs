/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load, loadPath, setupReact} from '../../harness/lib.mjs';

const {AntiHookComponent} = await load();
const {ResourceCache} = await loadPath('Carburetor/Resource/Cache/ResourceCache.mjs');
const {useResourceValue} = await load('Interop');
const hookAvailable = typeof useResourceValue === 'function';
const {React, flushSync, root, container} = await setupReact();
const count = 50;
const drain = async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    flushSync(() => {});
};
const run = async kind => {
    const calls = [];
    const pending = [];
    const renders = Array.from({length: count}, () => 0);
    const cache = new ResourceCache(id => {
        calls.push(id);
        const request = Promise.withResolvers();
        pending.push(request);
        return request.promise;
    }, {ttl: Infinity, maxEntries: Infinity});
    const settle = async start => {
        for (let index = start; index < pending.length; index++) {
            pending[index].resolve({id: calls[index], name: `user ${calls[index]}`, other: 0});
        }
        await drain();
    };
    class ClassReader extends AntiHookComponent {
        render() {
            renders[this.props.id]++;
            const view = this.useResource(cache, this.props.id);
            return React.createElement('span', null, view.data?.name ?? '…');
        }
    }
    const HookReader = ({id}) => {
        // oxlint-disable-next-line react/immutability -- Intentional per-reader render-count instrumentation.
        renders[id]++;
        const name = useResourceValue(cache, id, view => view.data?.name);
        return React.createElement('span', null, name ?? '…');
    };
    const Reader = kind === 'class' ? ClassReader : HookReader;
    flushSync(() => root.render(React.createElement('div', null,
        ...renders.map((_, id) => React.createElement(Reader, {key: id, id})))));
    await drain();
    await settle(0);
    const mountRenders = Math.max(...renders);
    const mountUniform = renders.every(value => value === mountRenders);
    const initialText = container.textContent;
    renders.fill(0);
    flushSync(() => cache.invalidateAll());
    await drain();
    const refetches = calls.length - count;
    const refreshText = container.textContent;
    await settle(count);
    const refreshRenders = Math.max(...renders);
    const refreshUniform = renders.every(value => value === refreshRenders);
    const textUnchanged = initialText === refreshText && initialText === container.textContent;
    const expectedText = Array.from({length: count}, (_, id) => `user ${id}`).join('');
    const textCorrect = initialText === expectedText && container.textContent === expectedText;
    const correct = mountUniform && refreshUniform && textUnchanged && textCorrect
        && calls.length === count * 2 && calls.every((id, index) => id === index % count);
    flushSync(() => root.render(null));
    return {mountRenders, refreshRenders, refetches, textUnchanged, textCorrect, correct};
};

// The class fixture always runs, including distributions without the new interop export.
const control = await run('class');
const hook = hookAvailable ? await run('hook') : {
    mountRenders: -1, refreshRenders: -1, refetches: -1,
    textUnchanged: false, textCorrect: false, correct: false,
};
flushSync(() => root.unmount());
emit({
    hookAvailable,
    hookMountRenders: hook.mountRenders,
    hookEqualRefreshRenders: hook.refreshRenders,
    hookRefetches: hook.refetches,
    hookTextUnchanged: hook.textUnchanged,
    hookTextCorrect: hook.textCorrect,
    classMountRenders: control.mountRenders,
    classEqualRefreshRenders: control.refreshRenders,
    classRefetches: control.refetches,
    classTextUnchanged: control.textUnchanged,
    classTextCorrect: control.textCorrect,
    done: control.correct && (!hookAvailable || hook.correct),
});
