import {Carburetor} from '@/Carburetor';
import {STATE_PUBLIC_REPLACEMENT} from '@/Carburetor/Models/Paths';

describe('restore claim lifetime across observer counts', () => {
    type State = {x: number};
    class Producer extends Carburetor<State> {
        public claim(state: State): boolean {
            return this.patchObservers?.ownRestore(state) === true;
        }
        // A patch with no publication: emitting would clear the claim anyway and mask the bug.
        // oxlint-disable-next-line carburetor/require-emit-after-draft-write
        public touch(value: number): void { this.draft.x = value; }
    }

    const runScenario = (observers: number): unknown[] => {
        const store = new Producer({x: 0});
        const facts: unknown[] = [];
        const owner = {};
        const target: State = {x: 1};
        for (let i = 0; i < observers; i++) {
            store.attachPatchListener({
                patch: (): void => {},
                restoreClaim: (state: unknown) =>
                    state === target ? {owner, representation: 'history-owned'} : undefined,
                publication: (fact?: unknown): void => { facts.push(fact); },
            });
        }
        store.claim(target);
        store.touch(5);
        store.setData(target);
        return facts;
    };

    test.each([1, 2])('claim does not survive an intermediate patch with %i observer(s)', count => {
        const facts = runScenario(count);
        expect(facts).toHaveLength(count);
        expect(facts[facts.length - 1]).toBe(STATE_PUBLIC_REPLACEMENT);
    });

    test('exact restore argument is still consumed once without an intermediate patch', () => {
        const store = new Producer({x: 0});
        const facts: unknown[] = [];
        const owner = {};
        const target: State = {x: 1};
        store.attachPatchListener({
            patch: (): void => {},
            restoreClaim: (state: unknown) =>
                state === target ? {owner, representation: 'history-owned'} : undefined,
            publication: (fact?: unknown): void => { facts.push(fact); },
        });
        store.claim(target);
        store.setData(target);
        expect(facts).toEqual([{origin: 'restore', owner, representation: 'history-owned'}]);
        store.setData({x: 2});
        expect(facts).toEqual([
            {origin: 'restore', owner, representation: 'history-owned'},
            STATE_PUBLIC_REPLACEMENT,
        ]);
    });
});
