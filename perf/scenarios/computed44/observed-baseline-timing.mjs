import assert from 'node:assert/strict';
import {emit, median} from '../../harness/lib.mjs';
import {api} from './api.mjs';

const {primary: {Carburetor, computed}} = await api();
const M = Number(process.argv[2]);
const lane = process.argv[3] ?? 'changed';
const constant = ['equal', 'constant', 'empty', 'cached'].includes(lane);
const expected = step => lane === 'cached' ? Math.max(M, 1)
    : constant ? 1 : (Math.max(M, 1) + step) * (lane === 'downstream' ? 2 : 1);
const fixture = instrumented => {
    const sources = Array.from({length: Math.max(M, 1)}, () => new Carburetor({n: 1}));
    let bodies = 0;
    const events = [];
    const body = read => {
        if (lane === 'empty') return 1;
        const sum = sources.reduce((n, source) => n + read(source).n, 0);
        return lane === 'equal' || lane === 'constant' ? 1 : sum;
    };
    const value = computed(instrumented ? read => { bodies++; return body(read); } : body);
    const downstream = lane === 'downstream' ? computed(read => 2 * read(value)) : value;
    const id = lane === 'unobserved' ? undefined
        : downstream.subscribe(instrumented ? () => events.push(downstream.get()) : () => {});
    return {downstream, events, bodies: () => bodies,
        operation: () => {
            if (lane !== 'cached') sources[0].update(draft => { draft.n++; });
            return downstream.get();
        },
        close: () => { if (id !== undefined) downstream.unsubscribe(id); }};
};
const validation = fixture(true);
try {
    for (let i = 1; i <= 8; i++) assert.equal(validation.operation(), expected(i));
    const before = validation.bodies();
    const eventStart = validation.events.length;
    const versionStart = validation.downstream.getVersion();
    let validationChecksum = 0;
    for (let i = 9; i <= 120; i++) {
        const current = validation.operation();
        assert.equal(current, expected(i));
        validationChecksum += current;
    }
    const deliveries = constant || lane === 'unobserved' ? 0 : 112;
    assert.equal(validation.events.length - eventStart, deliveries);
    assert.equal(validation.downstream.getVersion() - versionStart, deliveries);
    assert.equal(validation.bodies() - before, lane === 'empty' || lane === 'cached' ? 0 : 112);
    assert.deepEqual(validation.events.slice(eventStart), deliveries
        ? Array.from({length: 112}, (_, i) => expected(i + 9)) : []);
    assert.equal(validationChecksum, constant ? 112 * expected(0)
        : (112 * Math.max(M, 1) + 7224) * (lane === 'downstream' ? 2 : 1));
} finally { validation.close(); }
const f = fixture(false);
const samples = [];
let checksum = 0;
try {
    for (let i = 1; i <= 8; i++) assert.equal(f.operation(), expected(i));
    const versionStart = f.downstream.getVersion();
    for (let round = 0; round < 7; round++) {
        const start = performance.now();
        for (let i = 0; i < 16; i++) checksum += f.operation();
        samples.push((performance.now() - start) / 16);
        assert.equal(f.downstream.get(), expected(8 + (round + 1) * 16));
    }
    const versionDelta = f.downstream.getVersion() - versionStart;
    assert.equal(versionDelta, constant || lane === 'unobserved' ? 0 : 112);
    const expectedChecksum = constant ? 112 * expected(0)
        : (112 * Math.max(M, 1) + 7224) * (lane === 'downstream' ? 2 : 1);
    assert.equal(checksum, expectedChecksum);
    const finalValue = f.downstream.get();
    assert.equal(finalValue, expected(120));
    emit({M, lane, operations: samples.length * 16, checksum, finalValue, versionDelta,
        updateGetMs: median(samples), timingUnit: lane === 'cached' ? 'milliseconds per cached get'
            : 'milliseconds per completed source update+get', validationCorrect: true, correct: true, done: true});
} finally { f.close(); }
