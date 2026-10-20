import {Carburetor} from "@/Carburetor";

interface IEvents {
    tick: number;
}

class ProbeStore extends Carburetor<{value: number}, IEvents> {
    public fire(): void { this.emit('tick', 1); }
    public abortSignal(): AbortSignal { return this.signal; }
}

describe('dispose against abort listeners', () => {
    test('an event emitted from an abort listener during dispose reaches nobody', () => {
        const store = new ProbeStore({value: 0});
        const seen: number[] = [];
        store.on('tick', payload => { seen.push(payload); });
        store.abortSignal().addEventListener('abort', () => { store.fire(); });
        store.dispose();
        expect(seen).toEqual([]);
    });

    test('unsubscribing from an abort listener does not make dispose throw', () => {
        const store = new ProbeStore({value: 0});
        const id = store.subscribe(() => undefined);
        store.abortSignal().addEventListener('abort', () => { store.unsubscribe(id); });
        expect(() => store.dispose()).not.toThrow();
    });
});
