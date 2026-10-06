import {Carburetor, computed} from '@/Carburetor';
import {CARBURETOR_HAS_DRIFT} from '@/Carburetor/Store/Utils/Models';
import {WriteLog} from '@/Carburetor/Store/Paths/WriteLog';
import {TPath} from '@/Carburetor/Models/Paths';
import {READS_TRANSFER} from '@/Carburetor/Store/Paths/Markers/ReadsTransferBrand';

class Store extends Carburetor<{items: {value: number}[]; meta: Record<string, number>}> {
    public change(fn: (draft: {items: {value: number}[]; meta: Record<string, number>}) => void): void {
        this.update(fn);
    }
}

class CountingStore extends Store {
    public consultations = 0;
    constructor() {
        super({items: [{value: 1}], meta: {}});
        const log = this.writeLog;
        const proxy: WriteLog = Object.create(log);
        proxy.matches = (baseline: number, reads: ReadonlySet<TPath>): boolean => {
            this.consultations++;
            return log.matches(baseline, reads);
        };
        proxy.record = (version: number, writes: ReadonlySet<TPath>): void => {
            log.record(version, writes as Set<TPath>);
        };
        this.writeLog = proxy;
    }
    public drift(baseline: number, reads: ReadonlySet<TPath>): boolean {
        return this[CARBURETOR_HAS_DRIFT](baseline, reads);
    }
}

describe('R36-03 filed drift answers', () => {
    test('related notification answers true without consulting the write log', () => {
        const store = new CountingStore();
        const reads = new Set<TPath>(['items']);
        store.subscribe(() => undefined, {id: 'filed', reads, [READS_TRANSFER]: reads});
        const filedBaseline = store.getVersion();
        expect(store.drift(filedBaseline, reads)).toBe(false);
        expect(store.consultations).toBe(0);
        const beforeRelatedWrite = store.getVersion();
        store.change(draft => { draft.items[0].value++; });
        expect(store.drift(beforeRelatedWrite, reads)).toBe(true);
        expect(store.consultations).toBe(0);
        store.unsubscribe('filed');
    });

    test('an observed computed remains fresh after write-log compaction', () => {
        const store = new CountingStore();
        let runs = 0;
        const value = computed(read => { runs++; return read(store).items[0].value; });
        const id = value.subscribe(() => undefined);
        expect(value.get()).toBe(1);
        store.change(draft => {
            for (let i = 0; i < 9000; i++) draft.meta[`k${i}`] = i;
        });
        const before = runs;
        expect(value.get()).toBe(1);
        expect(runs).toBe(before);
        expect(store.consultations).toBe(0);
        value.unsubscribe(id);
    });
});
