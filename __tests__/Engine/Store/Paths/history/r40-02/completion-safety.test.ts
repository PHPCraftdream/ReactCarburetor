import {completeReads} from '@/Carburetor/Store/Tracking/Observation/completeReads';
import {completeObservation} from '@/Carburetor/Store/Tracking/Observation/completeObservation';
import {ReadStore} from './ReadStore';

describe('R40-02 completion and marker safety', () => {
    test('completeReads removes only implied markers and preserves identity', () => {
        const reads = new Set(['items.~p', 'items.r1.~p', 'items.r1.title', 'user.~p']);
        const completed = completeReads(reads);
        expect(completed).toBe(reads);
        expect([...completed]).toEqual(['items.r1.title', 'user.~p']);
    });

    test('completeObservation closes after descendant reads and preserves the pair', () => {
        const pair = {value: {title: 't'}, reads: new Set(['items.~p', 'items.r1.~p', 'items.r1.~k'])};
        const completed = completeObservation(pair);
        expect(completed).toBe(pair);
        expect([...completed.reads]).toEqual(['items.r1.~k']);
    });

    test('presence-only user marker survives alongside an unrelated pruned branch', () => {
        const store = new ReadStore();
        const reads = new Set<string>();
        expect(!!store.read(path => reads.add(path)).user).toBe(true);
        reads.add('items.~p');
        reads.add('items.r1.title');
        expect([...completeReads(reads)]).toEqual(['user.~p', 'items.r1.title']);
    });

    test('returning an empty branch preserves its marker while unrelated markers retire', () => {
        const store = new ReadStore(0);
        const reads = new Set<string>();
        const value = store.read(path => reads.add(path)).items;
        reads.add('filter.~p');
        reads.add('filter.text');
        const completed = completeObservation({value, reads});
        expect(completed.value).toBe(value);
        expect([...completed.reads]).toEqual(['items.~p', 'filter.text']);
    });

    test('in keeps the presence marker and deletion delivers false, not sibling writes', () => {
        const store = new ReadStore();
        const values: boolean[] = [];
        const stop = store.watch(d => 'r1' in d.items, next => values.push(next));
        try {
            expect(store.filed.at(-1)).toContain('items.r1.~p');
            store.change(d => { d.items.r2.title = 'sibling'; });
            expect(values).toEqual([]);
            store.change(d => { delete d.items.r1; });
            expect(values).toEqual([false]);
            expect(store.filed[0]).toEqual(['items.r1.~p']);
        } finally { stop(); }
    });

    test('leaf reader wakes for row replacement, deletion and parent replacement, not sibling', () => {
        const store = new ReadStore();
        const values: Array<string | undefined> = [];
        const stop = store.watch(d => d.items.r1?.title, next => values.push(next));
        try {
            store.change(d => { d.items.r2.title = 'sibling'; });
            expect(values).toEqual([]);
            store.change(d => { d.items.r1 = {title: 'replacement', done: false, owner: {name: 'new'}}; });
            expect(values).toEqual(['replacement']);
            store.change(d => { delete d.items.r1; });
            expect(values).toEqual(['replacement', undefined]);
            store.change(d => { d.items = {r1: {title: 'parent', done: false, owner: {name: 'p'}}}; });
            expect(values).toEqual(['replacement', undefined, 'parent']);
            expect(store.filed[0]).toEqual(['items.r1.title']);
        } finally { stop(); }
    });
});
