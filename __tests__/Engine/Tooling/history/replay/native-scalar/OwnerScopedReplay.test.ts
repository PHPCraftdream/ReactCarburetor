import {Carburetor, CarburetorHistory} from '@/Carburetor';

interface IState { n: number; date: Date; }

class RefusableStore extends Carburetor<IState> {
    public refuseDraft = false;
    public readonly refusal = new Error('nested draft refused');
    public refusedReads = 0;
    protected get draft(): IState {
        if (this.refuseDraft) {
            this.refusedReads++;
            throw this.refusal;
        }
        return super.draft;
    }
    public scalar(n: number): void { this.update(draft => { draft.n = n; }); }
}

class InspectedHistory extends CarburetorHistory<IState> {
    public inspect(): object {
        return {
            baseline: this.baseline.n, date: this.baseline.date.getTime(),
            past: this.past.length, future: this.future.length,
            kinds: [...this.past, ...this.future].map(entry => entry.kind),
            canUndo: this.canUndo(), canRedo: this.canRedo(),
        };
    }
}

const caught = (action: () => unknown): unknown => {
    try { action(); } catch (error) { return error; }
    return undefined;
};

// R39-02: a nested refused attempt cannot roll back an already installed outer replay.
describe.each(['undo', 'redo'] as const)('%s replay attempt ownership', direction => {
    test.each([false, true])('installed observer failure; nested refusal = %s', nested => {
        const store = new RefusableStore({n: 0, date: new Date(100)});
        const history = new InspectedHistory(store);
        const observerError = new Error('outer installed patch observer');
        let dispose = (): void => {};
        let entered = false;
        let subscriberCalls = 0;
        let patchThrows = 0;
        let installedAtThrow: number | undefined;
        let nestedError: unknown;
        let nestedBefore: object | undefined;
        let nestedAfter: object | undefined;
        const delivery: string[] = [];
        store.scalar(1);
        store.scalar(2);
        if (direction === 'redo') {
            expect(history.undo()).toBe(true);
            expect(history.undo()).toBe(true);
        }
        const subscription = store.subscribe(() => {
            if (entered || store.getData().n !== 1) return;
            entered = true;
            subscriberCalls++;
            delivery.push('subscriber');
            if (!nested) return;
            nestedBefore = history.inspect();
            store.refuseDraft = true;
            try {
                nestedError = caught(() => history[direction]());
            } finally { store.refuseDraft = false; }
            nestedAfter = history.inspect();
        }, {reads: new Set(['n'])});
        try {
            dispose = store.attachPatchListener({patch: patch => {
                if (patchThrows !== 0 || typeof patch === 'symbol' ||
                    patch.segments.length !== 1 || patch.segments[0] !== 'n' ||
                    patch.previous !== (direction === 'undo' ? 2 : 0) || patch.next !== 1) return;
                patchThrows++;
                installedAtThrow = store.getData().n;
                delivery.push('patch');
                throw observerError;
            }});
            const outerError = caught(() => history[direction]());
            delivery.push('returned');
            expect(outerError).toBe(observerError);
            expect(delivery).toEqual(['patch', 'subscriber', 'returned']);
            expect({patchThrows, installedAtThrow, subscriberCalls, refusedReads: store.refusedReads})
                .toEqual({patchThrows: 1, installedAtThrow: 1, subscriberCalls: 1, refusedReads: nested ? 1 : 0});
            if (nested) {
                expect(nestedError).toBe(store.refusal);
                expect(nestedAfter).toEqual(nestedBefore);
            }
            expect({live: store.getData().n, ...history.inspect()}).toEqual({
                live: 1, baseline: 1, date: 100, past: 1, future: 1,
                kinds: ['patches', 'patches'], canUndo: true, canRedo: true,
            });
            dispose();
            expect(history.redo()).toBe(true);
            expect(store.getData().n).toBe(2);
            expect(history.redo()).toBe(false);
            expect(history.undo()).toBe(true);
            expect(store.getData().n).toBe(1);
            expect(history.undo()).toBe(true);
            expect(store.getData().n).toBe(0);
            expect(history.undo()).toBe(false);
            expect({live: store.getData().n, ...history.inspect()}).toEqual({
                live: 0, baseline: 0, date: 100, past: 0, future: 2,
                kinds: ['patches', 'patches'], canUndo: false, canRedo: true,
            });
            expect(store.getData().date.getTime()).toBe(100);
        } finally {
            store.refuseDraft = false;
            dispose();
            store.unsubscribe(subscription);
            history.disconnect();
        }
    });
});

test('successful nested undo retains its cursor after the outer installed patch error', () => {
    const store = new RefusableStore({n: 0, date: new Date(100)});
    const history = new InspectedHistory(store);
    const observerError = new Error('outer installed patch');
    store.scalar(1);
    store.scalar(2);
    let entered = false;
    let nestedResult: boolean | undefined;
    let patchThrows = 0;
    const subscription = store.subscribe(() => {
        if (entered || store.getData().n !== 1) return;
        entered = true;
        nestedResult = history.undo();
    }, {reads: new Set(['n'])});
    const dispose = store.attachPatchListener({patch: patch => {
        if (typeof patch !== 'symbol' && patch.segments[0] === 'n' &&
            patch.previous === 2 && patch.next === 1 && patchThrows === 0) {
            patchThrows++;
            throw observerError;
        }
    }});
    try {
        expect(caught(() => history.undo())).toBe(observerError);
        expect({entered, nestedResult, patchThrows}).toEqual({entered: true, nestedResult: true, patchThrows: 1});
        expect({live: store.getData().n, ...history.inspect()}).toEqual({
            live: 0, baseline: 0, date: 100, past: 0, future: 2,
            kinds: ['patches', 'patches'], canUndo: false, canRedo: true,
        });
        dispose();
        expect(history.redo()).toBe(true);
        expect(store.getData().n).toBe(1);
        expect(history.redo()).toBe(true);
        expect(store.getData().n).toBe(2);
        expect(history.redo()).toBe(false);
    } finally { dispose(); store.unsubscribe(subscription); history.disconnect(); }
});
