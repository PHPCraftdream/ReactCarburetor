// Measures server-render cost for a list of AntiHookComponent rows over one store. Runs against
// the built production bundle:
//   npm run build && NODE_ENV=production node benchmarks/ssrAntiHookComponent.mjs
// Kept out of the test suite on purpose, like the other benchmarks/ scripts.
//
// Each row is a method-render AntiHookComponent reading this.useCarburetor(store).items[id].title.

import {renderToString} from 'react-dom/server';
import React from 'react';
import {AntiHookComponent, Carburetor} from '../dist/esm-prod/Carburetor/index.mjs';

const ROW_COUNT = 4000;
const WARMUP_PASSES = 2;
const MEASURED_PASSES = 5;

const buildStore = () => {
    const items = {};

    for (let i = 0; i < ROW_COUNT; i++) {
        items['row' + i] = {title: 'Row ' + i};
    }

    return new Carburetor({items});
};

class Row extends AntiHookComponent {
    /** One list row: reads its title through useCarburetor. */
    render() {
        const {id} = this.props;
        const title = this.useCarburetor(this.props.store).items[id].title;

        return React.createElement('li', null, title);
    }
}

class Page extends AntiHookComponent {
    /** The 4000-row list. */
    render() {
        const {store} = this.props;
        const rows = [];

        for (let i = 0; i < ROW_COUNT; i++) {
            rows.push(React.createElement(Row, {key: i, id: 'row' + i, store}));
        }

        return React.createElement('ul', null, rows);
    }
}

const renderOnce = () => {
    const store = buildStore();

    return renderToString(React.createElement(Page, {store}));
};

for (let i = 0; i < WARMUP_PASSES; i++) {
    renderOnce();
}

const samples = [];

for (let i = 0; i < MEASURED_PASSES; i++) {
    const started = process.hrtime.bigint();

    const html = renderOnce();

    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    samples.push(elapsedMs);

    if (i === 0) {
        console.log('output sanity check: ' + html.length + ' bytes, contains "Row 3999": ' +
            html.includes('Row 3999'));
    }
}

samples.sort((a, b) => a - b);

const sum = samples.reduce((total, sample) => total + sample, 0);
const mean = sum / samples.length;
const median = samples[Math.floor(samples.length / 2)];
const min = samples[0];
const max = samples[samples.length - 1];

console.log(`NODE_ENV=${process.env.NODE_ENV}, rows=${ROW_COUNT}, passes=${MEASURED_PASSES}`);
console.log(`mean:   ${mean.toFixed(3)} ms`);
console.log(`median: ${median.toFixed(3)} ms`);
console.log(`min:    ${min.toFixed(3)} ms`);
console.log(`max:    ${max.toFixed(3)} ms`);
