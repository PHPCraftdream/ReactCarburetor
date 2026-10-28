import {createResourceReader} from '@/Interop/createResourceReader';
import type {IResourceResolution, IResourceSource, IResourceView} from '@/Carburetor/Models/Resource';
import {EResourceStatus} from '@/Carburetor/Models/Enums/EResourceStatus';
type Args = [];
class Source implements IResourceSource<{value: number}, Args> {
    public calls = 0;
    public subscriptions = new Map<string, () => void>();
    public nextId = 0;
    public pending: Promise<void> | undefined;
    public fieldView = true;
    public failSubscribe = false;
    public version = 0;
    public resolve(..._args: Args): IResourceResolution<{value: number}> {
        const view: IResourceView<{value: number}> = {
            status: EResourceStatus.Idle, isIdle: true, isPending: false, isSuccess: false, isError: false,
            data: undefined, error: undefined, updatedAt: undefined, refreshing: false,
            invalidated: false, failed: false, stale: true,
        };
        const result: IResourceResolution<{value: number}> = {key: 'x', path: 'entry', present: false, view};
        if (this.fieldView) result.fieldView = (_resolution, record) => { record('entry.status'); return view; };
        return result;
    }
    public getVersion(): number { return this.version; }
    public subscribe(callback: () => void): string {
        if (this.failSubscribe) throw Error('subscribe failed');
        const id = `subscription-${++this.nextId}`;
        this.subscriptions.set(id, callback); return id;
    }
    public unsubscribe(id: string): void { this.subscriptions.delete(id); }
    public load(..._args: Args): Promise<void> { this.calls++; return this.pending ?? Promise.resolve(); }
}

describe('createResourceReader', () => {
    test('failed commit attachment restores the prior committed reader', () => {
        const source = new Source(); const reader = createResourceReader(source, 'entry');
        const old = reader.evaluate([], source.resolve(), view => view.status);
        reader.commit(old);
        const stop = reader.subscribe(() => {});
        source.failSubscribe = true;
        const next = reader.evaluate([], source.resolve(), view => view.stale);
        expect(() => reader.commit(next)).toThrow('subscribe failed');
        source.failSubscribe = false;
        expect(reader.getSnapshot(old)).toBe(old.token);
        expect(reader.getSnapshot(next)).toBe(next.token);
        expect(source.subscriptions.size).toBe(1);
        expect(() => stop()).not.toThrow();
        expect(source.subscriptions.size).toBe(0);
    });

    test('subscription failure during initial attachment is released', () => {
        const source = new Source(); source.failSubscribe = true;
        const reader = createResourceReader(source, 'entry');
        const candidate = reader.evaluate([], source.resolve(), view => view.status);
        reader.commit(candidate);
        expect(() => reader.subscribe(() => {})).toThrow('subscribe failed');
        expect(source.subscriptions.size).toBe(0);
        expect(() => reader.load()).not.toThrow();
        expect(source.calls).toBe(0);
    });

    test('legacy resolution without field view starts load without settlement ownership', () => {
        const source = new Source(); source.fieldView = false;
        let resolve!: () => void;
        source.pending = new Promise<void>(done => { resolve = done; });
        const reader = createResourceReader(source, 'entry');
        const candidate = reader.evaluate([], source.resolve(), view => view.status);
        reader.commit(candidate);
        const stop = reader.subscribe(() => {});
        reader.load();
        expect(source.calls).toBe(1);
        resolve();
        stop();
    });

});
