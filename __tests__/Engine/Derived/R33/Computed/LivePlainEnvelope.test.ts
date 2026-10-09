import {S} from "@/Carburetor/Store/Diagnostics/Internal/StoreIdentity";
import {act} from 'react';
import {Carburetor, computed} from '@/Carburetor';
import {SubscriberIndex} from '@/Carburetor/Store/Paths/SubscriberIndex';

describe('computed live plain envelopes (R33-01)', () => {
    interface IRow {
        title: string;
    }

    interface IRowListData {
        items: Record<number, IRow>;
    }

    class RowListCarburetor extends Carburetor<IRowListData> {
        public setTitle = (index: number, title: string) => {
            this.draft.items[index].title = title;
            this.emitUpdate();
        };
    }

    class InspectableIndex extends SubscriberIndex {
        public readsFor(id: string) {
            return this.readsById.get(id);
        }
    }

    class InspectableRowListCarburetor extends RowListCarburetor {
        public override [S.subscriberIndex] = new InspectableIndex();

        public readsForComputed(id: string): Set<string> | undefined {
            return this[S.subscriberIndex].readsById.get(id);
        }
    }

    const ROWS = 2000;

    const getRowListData = (): IRowListData => ({
        items: Object.fromEntries(
            Array.from({length: ROWS}, (_, index: number) => [index, {title: 'row-' + index}])
        ),
    });

    test('settling a stable plain envelope does not add row reads or key markers (R33-01)', () => {
        const c = new InspectableRowListCarburetor(getRowListData());
        const envelope: {rows: Record<number, IRow> | undefined} = {rows: undefined};
        const rows = computed(read => {
            envelope.rows = read(c).items;
            return envelope;
        });
        void rows.get().rows?.[5].title;
        rows.subscribe(() => {
            void rows.get().rows?.[5].title;
        }, {id: 'listener'});
        const computedUid = (rows as unknown as {uid: string}).uid;
        const reads = c.readsForComputed(computedUid)!;
        const priorSize = reads.size;

        act(() => c.setTitle(5, 'edited'));

        const settledReads = c.readsForComputed(computedUid)!;
        expect(settledReads.size).toBeLessThanOrEqual(priorSize);
        expect([...settledReads].some(path => path.includes('~k'))).toEqual(false);
    });
});
