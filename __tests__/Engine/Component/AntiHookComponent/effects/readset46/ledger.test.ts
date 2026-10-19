import {ReadLedger} from '@/Carburetor/Store/Paths/Markers/ReadLedger';
import {TPath} from '@/Carburetor/Models/Paths';
import {measure} from './support';

const RAW = ['items.~p', 'items.length', 'items.0.~p', 'items.0.title', 'items.1.~p', 'items.1.title', 'flag'];
const source = {};

/** A ledger that learned RAW, with the closed set it filed. */
const learned = () => {
    const ledger = new ReadLedger();
    const filed = ledger.learn(new Set<TPath>(RAW), source);
    return {ledger, filed};
};

const owner = () => ({spill: (): void => undefined});

/** An owner that records what its ledger hands back when it is spilled. */
const spilling = (ledger: ReadLedger) => {
    const spilled: TPath[] = [];
    return {spilled, spill: (): void => { spilled.push(...ledger.release()); }};
};

const sorted = (paths: Iterable<TPath>): TPath[] => [...paths].sort((a, b) => a.localeCompare(b));

describe('ReadLedger', () => {
    test('learning closes the raw recording in place', () => {
        const {filed} = learned();
        expect(sorted(filed)).toEqual(['flag', 'items.0.title', 'items.1.title', 'items.length']);
    });

    test('an identical recording, in any order and with repeats, settles on the filed set', () => {
        const {ledger, filed} = learned();
        expect(ledger.claim(owner(), source, filed)).toBe(true);
        for (const path of [...RAW].reverse()) expect(ledger.hit(path)).toBe(true);
        expect(ledger.hit('items.length')).toBe(true);
        expect(ledger.settle()).toBe(filed);
    });

    test('a lost path does not settle; the counted paths are copied out', () => {
        const {ledger, filed} = learned();
        ledger.claim(owner(), source, filed);
        for (const path of RAW.slice(0, -1)) ledger.hit(path);
        ledger.hit('items.0.title');
        expect(ledger.settle()).toBeUndefined();
        expect([...ledger.release()]).toEqual(RAW.slice(0, -1));
    });

    test('an unknown path is a miss', () => {
        const {ledger, filed} = learned();
        ledger.claim(owner(), source, filed);
        expect(ledger.hit('items.2.title')).toBe(false);
    });

    test('claims need the registered set, the same source and an unmodified filed set', () => {
        const {ledger, filed} = learned();
        expect(new ReadLedger().claim(owner(), source, filed)).toBe(false);
        expect(ledger.claim(owner(), source, new Set(filed))).toBe(false);
        expect(ledger.claim(owner(), {}, filed)).toBe(false);
        const copy = new Set(filed) as unknown as typeof filed;
        ledger.adopt(filed, copy);
        expect(ledger.claim(owner(), source, copy)).toBe(true);
        (copy as unknown as Set<TPath>).add('late');
        expect(ledger.claim(owner(), source, copy)).toBe(false);
    });

    test('a new claim spills the previous owner with its own counted paths', () => {
        const {ledger, filed} = learned();
        const first = spilling(ledger);
        ledger.claim(first, source, filed);
        ledger.hit('flag');
        ledger.hit('items.~p');
        ledger.claim(owner(), source, filed);
        expect(sorted(first.spilled)).toEqual(['flag', 'items.~p']);
        for (const path of RAW) ledger.hit(path);
        expect(ledger.settle()).toBe(filed);
    });

    test('relearning keeps only the new recording', () => {
        const {ledger} = learned();
        const next = ledger.learn(new Set<TPath>(['flag', 'other.~p']), source);
        expect(ledger.claim(owner(), source, next)).toBe(true);
        expect(ledger.hit('items.length')).toBe(false);
        ledger.hit('flag');
        ledger.hit('other.~p');
        expect(ledger.settle()).toBe(next);
    });

    test('the own recording settles without allocating, and copies out on divergence', () => {
        const {ledger, filed} = learned();
        const work = measure(() => {
            ledger.open(source, filed);
            for (const path of RAW) ledger.record(path);
            expect(ledger.covered(filed)).toBe(true);
            expect(ledger.close(true)).toBe(filed);
        });
        expect(work).toEqual({sets: 0, slices: 0, prunes: 0});

        ledger.open(source, filed);
        ledger.record('flag');
        ledger.record('extra');
        expect(ledger.covered(filed)).toBe(false);
        expect([...ledger.spill()]).toEqual(['flag', 'extra']);
        const next = ledger.close(false);
        expect([...next]).toEqual(['flag', 'extra']);
        ledger.open(source, next);
        ledger.record('extra');
        ledger.record('flag');
        expect(ledger.close(false)).toBe(next);
    });

    test('without a baseline the own recording completes without learning unless asked', () => {
        const ledger = new ReadLedger();
        expect(ledger.open(source, undefined)).toBe(false);
        ledger.begin(new Set<TPath>());
        ledger.record('a.~p');
        ledger.record('a.b');
        const first = ledger.close(false);
        expect([...first]).toEqual(['a.b']);
        if (!ledger.open(source, first)) ledger.begin(new Set<TPath>());
        ledger.record('a.~p');
        ledger.record('a.b');
        const learnedSet = ledger.close(true);
        expect(learnedSet).not.toBe(first);
        ledger.open(source, learnedSet);
        ledger.record('a.b');
        ledger.record('a.~p');
        expect(ledger.close(true)).toBe(learnedSet);
    });
});
