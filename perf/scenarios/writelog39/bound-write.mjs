/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R39-01: wall time of one related write that follows two unrelated publications (median of many).
import {emit, load, median, setupReact} from '../../harness/lib.mjs';

const {Carburetor, AntiHookComponent} = await load();
const {useCarburetorValue} = await load('Interop');
const size = Number(process.argv[2] ?? 10000);
const route = process.argv[3] ?? 'watch';
const rounds = 21;
class Store extends Carburetor { change(fn) { this.update(fn); } }
const select = d => d.items;
const store = new Store({tick: 0, items: Array.from({length: size}, (_, id) => ({id, title: `T${id}`}))});
let renders = 0;
let latest = select(store.getData());
let container;
let root;
let flush = fn => fn();
let stop;
if (route === 'watch') {
    stop = store.watch(select, next => { renders++; latest = next; });
} else {
    const dom = await setupReact();
    ({root, container} = dom);
    flush = dom.flushSync;
    const {React} = dom;
    const output = items => {
        renders++; latest = items;
        return React.createElement('output', null, `${items[7].title}:${items.length}`);
    };
    const Hook = () => output(useCarburetorValue(store, select));
    class Owner extends AntiHookComponent {
        items = this.connectSelection(store, select);
        render() { return output(this.items()); }
    }
    flush(() => root.render(React.createElement(route === 'hook' ? Hook : Owner)));
}
const initialRenders = renders;
const samples = [];
let correct = latest !== undefined && latest.length === size;
for (let k = 1; k <= rounds; k++) {
    for (let t = 0; t < 2; t++) flush(() => store.change(d => { d.tick++; }));
    const quiet = renders === initialRenders + k - 1;
    const start = performance.now();
    flush(() => store.change(d => { d.items[7].title = `K${k}`; }));
    samples.push(performance.now() - start);
    correct &&= quiet && renders === initialRenders + k && latest[7].title === `K${k}`
        && (!container || container.textContent === `K${k}:${size}`);
}
stop?.();
root?.unmount();
emit({
    size, relatedWriteMs: median(samples), worstWriteMs: Math.max(...samples),
    renders: renders - initialRenders, text: latest[7].title + ':' + latest.length, done: correct,
});
