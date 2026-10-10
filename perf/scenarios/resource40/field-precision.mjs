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
const run = async (kind, field) => {
    let calls = 0;
    let renders = 0;
    const cache = new ResourceCache(() => {
        calls++;
        return Promise.resolve({name: 'initial', other: 'initial'});
    }, {ttl: Infinity, maxEntries: Infinity});
    await cache.load(0);
    const key = cache.resolve(0).key;
    const initial = cache.snapshot();
    initial.entries[key].error = 'initial';
    cache.setData(initial);
    const read = view => field === 'error' ? view.error : view.data?.[field];
    class ClassReader extends AntiHookComponent {
        render() {
            renders++;
            return React.createElement('span', null, read(this.useResource(cache, 0)) ?? '…');
        }
    }
    const HookReader = () => {
        renders++;
        const value = useResourceValue(cache, 0, read);
        return React.createElement('span', null, value ?? '…');
    };
    flushSync(() => root.render(React.createElement(kind === 'class' ? ClassReader : HookReader)));
    await drain();
    const mountRenders = renders;
    const mountCorrect = container.textContent === 'initial';
    const write = target => {
        const next = cache.snapshot();
        if (target === 'error') next.entries[key].error = 'changed';
        else next.entries[key].data[target] = 'changed';
        flushSync(() => cache.setData(next));
    };
    renders = 0;
    // Keep resource-field controls; the other reader also checks nested data precision.
    if (field === 'name') write('error');
    else if (field === 'other') write('name');
    else {
        write('other');
        write('name');
    }
    await drain();
    const unreadRenders = renders;
    const unreadTextCorrect = container.textContent === 'initial';
    renders = 0;
    write(field);
    await drain();
    const readRenders = renders;
    const textCorrect = mountCorrect && unreadTextCorrect && container.textContent === 'changed';
    const correct = textCorrect && calls === 1 && cache.getEntry(0).data.name === 'changed'
        && (field === 'other'
            ? cache.getEntry(0).data.other === 'changed' && cache.getEntry(0).error === 'initial'
            : cache.getEntry(0).error === 'changed');
    flushSync(() => root.render(null));
    return {mountRenders, unreadRenders, readRenders, calls, textCorrect, correct};
};
const results = {};
for (const field of ['name', 'error', 'other']) {
    results['class' + field] = await run('class', field);
    results['hook' + field] = hookAvailable ? await run('hook', field) : {
        mountRenders: -1, unreadRenders: -1, readRenders: -1, calls: -1, textCorrect: false, correct: false,
    };
}
flushSync(() => root.unmount());
emit({
    hookAvailable,
    hookNameUnreadRenders: results.hookname.unreadRenders,
    hookNameReadRenders: results.hookname.readRenders,
    hookErrorUnreadRenders: results.hookerror.unreadRenders,
    hookErrorReadRenders: results.hookerror.readRenders,
    hookOtherUnreadRenders: results.hookother.unreadRenders,
    hookOtherReadRenders: results.hookother.readRenders,
    hookTextCorrect: results.hookname.textCorrect && results.hookerror.textCorrect && results.hookother.textCorrect,
    classNameUnreadRenders: results.classname.unreadRenders,
    classNameReadRenders: results.classname.readRenders,
    classErrorUnreadRenders: results.classerror.unreadRenders,
    classErrorReadRenders: results.classerror.readRenders,
    classOtherUnreadRenders: results.classother.unreadRenders,
    classOtherReadRenders: results.classother.readRenders,
    classTextCorrect: results.classname.textCorrect && results.classerror.textCorrect && results.classother.textCorrect,
    done: results.classname.correct && results.classerror.correct && results.classother.correct
        && (!hookAvailable || (results.hookname.correct && results.hookerror.correct && results.hookother.correct)),
});
