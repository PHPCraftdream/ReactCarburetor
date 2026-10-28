import {Carburetor} from '@/Carburetor';
import {dateExposureLedger} from '@/Carburetor/Store/Tracking/Proxy/dateExposureLedger';
import {createProxyCache} from '@/Carburetor/Store/Tracking/Proxy/createProxyCache';
import {RAW_EXPOSURE} from '@/Carburetor/Models/Paths';

interface IState {date: Date; count: number}

class UpdateStore extends Carburetor<IState> {
    write(mutate: (draft: IState) => void): void { this.update(mutate); }
}

describe('Date exposure observable boundaries', () => {
    test('a Date exposed while reading an unchanged state does not notify', () => {
        const store = new UpdateStore({date: new Date(1), count: 0});
        let wakes = 0;
        const subscriptionId = store.subscribe(() => { wakes++; }, {reads: new Set(['date'])});
        store.write(draft => { void draft.date; });
        expect(wakes).toBe(0);
        store.unsubscribe(subscriptionId);
    });

    test('mutating a live exposed Date publishes; mutating a detached Date does not', () => {
        const store = new UpdateStore({date: new Date(1), count: 0});
        let wakes = 0;
        let detached!: Date;
        const subscriptionId = store.subscribe(() => { wakes++; }, {reads: new Set(['date'])});
        store.write(draft => { detached = draft.date; });
        store.write(draft => { draft.date.setTime(2); });
        expect(wakes).toBe(1);
        store.write(draft => { draft.date = new Date(3); });
        wakes = 0;
        detached.setTime(4);
        store.write(draft => { draft.count++; });
        expect(wakes).toBe(0);
        expect(store.getData().date.getTime()).toBe(3);
        store.unsubscribe(subscriptionId);
    });

    test('subclass update wrapper still publishes through the protected update method', () => {
        const store = new UpdateStore({date: new Date(1), count: 0});
        let wakes = 0;
        const subscriptionId = store.subscribe(() => { wakes++; }, {reads: new Set(['count'])});
        store.write(draft => { draft.count = 1; });
        expect(store.getData().count).toBe(1);
        expect(wakes).toBe(1);
        store.unsubscribe(subscriptionId);
    });

    test('flush records mutated exposed dates and reports listener and recorder failures', () => {
        const root = {};
        const cache = createProxyCache();
        const paths: unknown[][] = [];
        const firstError = new Error('listener failed');
        const laterError = new Error('recorder failed');
        const port = {listener: (): void => { throw firstError; }};
        const makeRecord = (error?: Error) => (path: string, target?: object): void => {
            paths.push([path, target]);
            if (error !== undefined) throw error;
        };
        const sourceA: Record<string, unknown> = {date: new Date(1)};
        const sourceB: Record<string, unknown> = {date: new Date(1)};
        const ordinary = sourceA.date as Date;
        const unusual = new (class extends Date {}) (1);
        sourceB.date = unusual;
        dateExposureLedger.expose(
            port as never, sourceA, 'date', ordinary, root, makeRecord(), 'date', cache as never,
        );
        dateExposureLedger.expose(
            port as never, sourceB, 'date', unusual, root, makeRecord(laterError), 'date', cache as never,
        );
        ordinary.setTime(2);
        unusual.setTime(2);
        expect(() => dateExposureLedger.flush(port as never)).toThrow(firstError);
        expect(paths).toEqual(expect.arrayContaining([
            ['date', ordinary], ['date.~p', RAW_EXPOSURE],
        ]));
        expect(dateExposureLedger.flush(port as never)).toBe(false);

        const successfulPort = {listener: (): void => undefined};
        const successfulSource: Record<string, unknown> = {date: new Date(1)};
        const successfulSubclass = new (class extends Date {}) (1);
        successfulSource.date = successfulSubclass;
        const successfulPaths: unknown[][] = [];
        dateExposureLedger.expose(
            successfulPort as never, successfulSource, 'date', successfulSubclass,
            root,
            (path: string, target?: object): void => { successfulPaths.push([path, target]); },
            'date',
            cache as never,
        );
        successfulSubclass.setTime(2);
        expect(dateExposureLedger.flush(successfulPort as never)).toBe(true);
        expect(successfulPaths).toEqual(expect.arrayContaining([
            ['date', successfulSubclass], ['date.~p', RAW_EXPOSURE],
        ]));

        const port2 = {listener: (): void => undefined};
        const sourceC: Record<string, unknown> = {date: new Date(1)};
        const changed = sourceC.date as Date;
        dateExposureLedger.expose(
            port2 as never, sourceC, 'date', changed, root, makeRecord(laterError), 'date', cache as never,
        );
        changed.setTime(2);
        expect(() => dateExposureLedger.flush(port2 as never)).toThrow(laterError);
    });
});
