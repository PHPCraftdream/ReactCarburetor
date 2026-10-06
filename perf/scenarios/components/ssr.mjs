/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Server render of an AntiHookComponent list: rows carry no per-instance proxy or hook method
// fields (R13-06) and the render cost scales linearly from rows/4 to rows — both fixtures
// measured in one process with alternating samples, so machine drift moves both sides.
// Args: [rows=4000] [samples=3]
import {emit, load, median} from '../../harness/lib.mjs';

const {AntiHookComponent, Carburetor} = await load();
const {renderToString} = await import('react-dom/server');
const React = (await import('react')).default;

const rows = Number(process.argv[2] ?? 4000);
const samples = Number(process.argv[3] ?? 3);
const METHODS = ['useCarburetor', 'connect', 'connectSelection', 'declareConnection',
    'useComputed', 'useResource', 'useEffect'];

const buildFixture = count => {
    const items = {};
    for (let i = 0; i < count; i++) {
        items['row' + i] = {title: 'Row ' + i};
    }
    const store = new Carburetor({items});
    let rowInstance;
    class Row extends AntiHookComponent {
        /** One list row: reads its title through useCarburetor; `grab` captures the instance. */
        render() {
            const {id, grab} = this.props;
            if (grab) rowInstance = this;
            return React.createElement('li', null, this.useCarburetor(store).items[id].title);
        }
    }
    class Page extends AntiHookComponent {
        /** The whole list, with the first row grabbed for the instance-shape check. */
        render() {
            const ids = [];
            for (let i = 0; i < count; i++) {
                ids.push('row' + i);
            }
            return React.createElement('ul', null, ids.map((id, index) =>
                React.createElement(Row, {key: index, id, grab: index === 0, store})));
        }
    }
    return {element: () => React.createElement(Page), instance: () => rowInstance};
};

const small = buildFixture(Math.floor(rows / 4));
const large = buildFixture(rows);
const measure = fixture => {
    const start = performance.now();
    const html = renderToString(fixture.element());
    return {ms: performance.now() - start, html};
};
measure(small);
measure(small);
measure(large);
measure(large);
const smallTimes = [];
const largeTimes = [];
let largeHtml = '';
for (let i = 0; i < samples; i++) {
    smallTimes.push(measure(small).ms);
    const result = measure(large);
    largeTimes.push(result.ms);
    largeHtml = result.html;
}
// R13-06 mechanism: the hook methods are prototype members, not per-instance fields.
const instance = large.instance();
const instanceMethodFields = METHODS.filter(name =>
    Object.hasOwn(instance, name) && typeof instance[name] === 'function').length;
emit({ssrSmallMs: median(smallTimes), ssrLargeMs: median(largeTimes),
    htmlChars: largeHtml.length, hasLastRow: largeHtml.includes('Row ' + (rows - 1)),
    instanceMethodFields});
