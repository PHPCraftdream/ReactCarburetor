/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load, loadPath, setupReact} from '../../harness/lib.mjs';

const {AntiHookComponent} = await load();
const {ResourceCache} = await loadPath('Carburetor/Resource/Cache/ResourceCache.mjs');
const {React, flushSync, root, container} = await setupReact();
const count = 50;
const drain = async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    flushSync(() => {});
};
const fixture = () => {
    const calls = [];
    const pending = [];
    const cache = new ResourceCache(id => {
        calls.push(id);
        const request = Promise.withResolvers();
        pending.push(request);
        return request.promise;
    }, {ttl: Infinity, maxEntries: Infinity});
    const settle = async (start, end) => {
        for (let index = start; index < end; index++) {
            pending[index].resolve({id: calls[index], name: `user ${calls[index]}`});
        }
        await drain();
    };
    return {cache, calls, settle};
};
const data = fixture();
const renders = Array.from({length: count}, () => 0);
class DataReader extends AntiHookComponent {
    render() {
        renders[this.props.id]++;
        const view = this.useResource(data.cache, this.props.id);
        return React.createElement('span', null, view.data?.name ?? '…');
    }
}
flushSync(() => root.render(React.createElement('div', null,
    ...renders.map((_, id) => React.createElement(DataReader, {key: id, id})))));
await drain();
await data.settle(0, count);
const rendersPerReaderOnMount = Math.max(...renders);
const mountUniform = renders.every(value => value === rendersPerReaderOnMount);
const initialText = container.textContent;
renders.fill(0);
flushSync(() => data.cache.invalidateAll());
await drain();
const refetchesAfterInvalidateAll = data.calls.length - count;
const textDuringRefresh = container.textContent;
await data.settle(count, count * 2);
const rendersPerReaderOnEqualRefresh = Math.max(...renders);
const refreshUniform = renders.every(value => value === rendersPerReaderOnEqualRefresh);
const textUnchanged = initialText === textDuringRefresh && initialText === container.textContent;
const dataCorrect = initialText === Array.from({length: count}, (_, id) => `user ${id}`).join('')
    && data.calls.every((id, index) => id === index % count) && data.calls.length === count * 2;
flushSync(() => root.render(null));

const controls = {};
for (const field of ['refreshing', 'status']) {
    const control = fixture();
    const values = [];
    class IndicatorReader extends AntiHookComponent {
        render() {
            const value = this.useResource(control.cache, 0)[field];
            values.push(value);
            return React.createElement('span', null, String(value));
        }
    }
    flushSync(() => root.render(React.createElement(IndicatorReader)));
    await drain();
    await control.settle(0, 1);
    controls[field + 'MountRenders'] = values.length;
    controls[field + 'MountValues'] = values.join(',');
    values.length = 0;
    flushSync(() => control.cache.invalidateAll());
    await drain();
    await control.settle(1, 2);
    controls[field + 'RefreshRenders'] = values.length;
    controls[field + 'RefreshValues'] = values.join(',');
    controls[field + 'Correct'] = control.calls.length === 2
        && container.textContent === (field === 'refreshing' ? 'false' : 'success');
    flushSync(() => root.render(null));
}
flushSync(() => root.unmount());
emit({
    rendersPerReaderOnMount, rendersPerReaderOnEqualRefresh, textUnchanged, refetchesAfterInvalidateAll,
    ...controls,
    done: mountUniform && refreshUniform && dataCorrect && textUnchanged
        && controls.refreshingCorrect && controls.statusCorrect,
});
