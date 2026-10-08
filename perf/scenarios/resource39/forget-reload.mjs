/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R39-07: a data-only useResource reader whose pending entry is removed must reload; the bare
// creation of that entry must not render it. ManualThrottle holds the creation notification
// until flush(), so a removal can arrive in the same delivery as the creation.
import {emit, load, loadPath, setupReact} from '../../harness/lib.mjs';

const {AntiHookComponent, ComponentUpdateThrottle} = await load();
const {ResourceCache} = await loadPath('Carburetor/Resource/Cache/ResourceCache.mjs');
const {React, flushSync, root} = await setupReact();
class ManualThrottle extends ComponentUpdateThrottle {
    setupTimeout() {}
    flush() { this.letsUpdate(); }
}
const drain = async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    flushSync(() => {});
};
const run = async (action, throttled) => {
    const throttle = throttled ? new ManualThrottle() : undefined;
    let calls = 0;
    let renders = 0;
    const cache = new ResourceCache(() => { calls++; return new Promise(() => undefined); },
        throttle ? {scheduler: throttle} : {});
    class Reader extends AntiHookComponent {
        render() {
            renders++;
            return React.createElement('span', null, this.useResource(cache, 1).data ? 'data' : 'none');
        }
    }
    flushSync(() => root.render(React.createElement(Reader)));
    await drain();
    const mountCalls = calls;
    const mountRenders = renders;
    flushSync(() => {
        if (action === 'forget') cache.forget(1);
        else if (action === 'restore') cache.restore({entries: {}});
        throttle?.flush();
    });
    await drain();
    const result = {mountCalls, calls, extraRenders: renders - mountRenders};
    flushSync(() => root.render(null));
    return result;
};
const forget = await run('forget', false);
const forgetThrottled = await run('forget', true);
const restore = await run('restore', false);
const restoreThrottled = await run('restore', true);
const control = await run('none', true);
flushSync(() => root.unmount());
const all = [forget, forgetThrottled, restore, restoreThrottled, control];
emit({
    forgetCalls: forget.calls, forgetExtraRenders: forget.extraRenders,
    forgetThrottledCalls: forgetThrottled.calls, forgetThrottledExtraRenders: forgetThrottled.extraRenders,
    restoreCalls: restore.calls, restoreExtraRenders: restore.extraRenders,
    restoreThrottledCalls: restoreThrottled.calls, restoreThrottledExtraRenders: restoreThrottled.extraRenders,
    controlCalls: control.calls, controlExtraRenders: control.extraRenders,
    mountCalls: all.map(item => item.mountCalls).join(','),
    done: all.every(item => item.mountCalls === 1),
});
