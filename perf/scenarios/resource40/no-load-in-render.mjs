/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load, loadPath, setupReact} from '../../harness/lib.mjs';

const {AntiHookComponent} = await load();
const {ResourceCache} = await loadPath('Carburetor/Resource/Cache/ResourceCache.mjs');
const {useResourceValue} = await load('Interop');
const hookAvailable = typeof useResourceValue === 'function';
const {React, flushSync, root, container} = await setupReact();
const drain = async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    flushSync(() => {});
};
const run = async kind => {
    let rendering = false;
    let committed = false;
    let calls = 0;
    let renderCalls = 0;
    let beforeCommitCalls = 0;
    const request = Promise.withResolvers();
    const cache = new ResourceCache(() => {
        calls++;
        if (rendering) renderCalls++;
        if (!committed) beforeCommitCalls++;
        return request.promise;
    }, {ttl: Infinity, maxEntries: Infinity});
    const markCommitted = node => {
        if (node !== null) committed = true;
    };
    const text = view => React.createElement('span', {ref: markCommitted}, view.data?.name ?? '…');
    class ClassReader extends AntiHookComponent {
        render() {
            rendering = true;
            try {
                return text(this.useResource(cache, 0));
            } finally {
                rendering = false;
            }
        }
    }
    const HookReader = () => {
        rendering = true;
        try {
            return text(useResourceValue(cache, 0));
        } finally {
            rendering = false;
        }
    };
    flushSync(() => root.render(React.createElement(kind === 'class' ? ClassReader : HookReader)));
    await drain();
    const afterCommitCalls = calls;
    const pendingTextCorrect = container.textContent === '…';
    request.resolve({name: 'loaded'});
    await drain();
    const textCorrect = pendingTextCorrect && container.textContent === 'loaded';
    const correct = committed && textCorrect && calls === afterCommitCalls
        && cache.getEntry(0)?.status === 'success';
    flushSync(() => root.render(null));
    return {renderCalls, beforeCommitCalls, afterCommitCalls, textCorrect, correct};
};
const control = await run('class');
const hook = hookAvailable ? await run('hook') : {
    renderCalls: -1, beforeCommitCalls: -1, afterCommitCalls: -1, textCorrect: false, correct: false,
};
flushSync(() => root.unmount());
emit({
    hookAvailable,
    hookLoaderCallsInRender: hook.renderCalls,
    hookLoaderCallsBeforeCommit: hook.beforeCommitCalls,
    hookLoaderCallsAfterCommit: hook.afterCommitCalls,
    hookTextCorrect: hook.textCorrect,
    classLoaderCallsInRender: control.renderCalls,
    classLoaderCallsBeforeCommit: control.beforeCommitCalls,
    classLoaderCallsAfterCommit: control.afterCommitCalls,
    classTextCorrect: control.textCorrect,
    done: control.correct && (!hookAvailable || hook.correct),
});
