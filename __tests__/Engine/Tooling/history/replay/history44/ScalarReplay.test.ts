import {Carburetor, CarburetorHistory} from '@/Carburetor';

class Scalar extends Carburetor<{box: {n: unknown}; spare: number}> {
    public batch(values: unknown[]): void {
        this.update(d => { for (const value of values) d.box.n = value; });
    }
}

describe('history44 scalar replay preserves original observer operations', () => {
    test.each([1, 8, 32, 64])('%s repeated writes replay in exact reverse and forward order', p => {
        const store = new Scalar({box: {n: 0}, spare: 7});
        const history = new CarburetorHistory(store);
        const trace: unknown[] = [];
        let wakes = 0, spare = 0;
        const dispose = store.attachPatchListener({patch: patch => {
            if (typeof patch !== 'symbol') trace.push(patch.next);
        }});
        const id = store.subscribe(() => wakes++);
        const stop = store.watch(d => d.spare, () => spare++);
        try {
            store.batch(Array.from({length: p}, (_, i) => i + 1));
            expect(trace).toEqual(Array.from({length: p}, (_, i) => i + 1));
            trace.length = 0;
            expect(history.undo()).toBe(true);
            expect(trace).toEqual(Array.from({length: p}, (_, i) => p - i - 1));
            expect(store.getData().box.n).toBe(0);
            trace.length = 0;
            expect(history.redo()).toBe(true);
            expect(trace).toEqual(Array.from({length: p}, (_, i) => i + 1));
            expect(store.getData().box.n).toBe(p);
            store.batch([p]);
            expect(wakes).toBe(3);
            expect(spare).toBe(0);
        } finally { dispose(); stop(); store.unsubscribe(id); history.disconnect(); }
    });

    test.each([NaN, -0, null, undefined, Symbol('leaf'), (): number => 1])(
        'SameValue scalar endpoint %s is restored without graph identity policy', value => {
            const store = new Scalar({box: {n: 1}, spare: 7});
            const history = new CarburetorHistory(store);
            try {
                store.batch([value]);
                expect(Object.is(store.getData().box.n, value)).toBe(true);
                expect(history.undo()).toBe(true);
                expect(store.getData().box.n).toBe(1);
                expect(history.redo()).toBe(true);
                expect(Object.is(store.getData().box.n, value)).toBe(true);
                store.batch([value]);
                expect(history.undo()).toBe(true);
                expect(store.getData().box.n).toBe(1);
                expect(history.undo()).toBe(false);
            } finally { history.disconnect(); }
        }
    );

    test('installed replay observer error cannot roll back its cursor; later branch stays undoable', () => {
        const store = new Scalar({box: {n: 0}, spare: 7});
        const history = new CarburetorHistory(store);
        store.batch([1, 2, 3]);
        const error = new Error('installed replay observer');
        const dispose = store.attachPatchListener({patch: patch => {
            if (typeof patch !== 'symbol' && patch.next === 2) throw error;
        }});
        try {
            expect(() => history.undo()).toThrow(error);
            // The first inverse patch lands (3 -> 2) before the observer interrupts replay.
            expect(store.getData().box.n).toBe(2);
            expect(history.canUndo()).toBe(false);
            expect(history.canRedo()).toBe(true);
            dispose();
            store.batch([9]);
            expect(history.canRedo()).toBe(false);
            expect(history.undo()).toBe(true);
            expect(store.getData().box.n).toBe(2);
        } finally { dispose(); history.disconnect(); }
    });
});
