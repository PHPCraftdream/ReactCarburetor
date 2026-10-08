import * as React from 'react';
import {rstest} from '@rstest/core';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';
import {CARBURETOR_PATHS_SINCE} from '@/Carburetor/Store/Utils/Models';

class Store extends Carburetor<{rows: Array<{n: number}>; tick: number}> {
    public late: (() => void) | undefined;
    public override subscribe(...args: Parameters<Carburetor<{rows: Array<{n: number}>; tick: number}>['subscribe']>) {
        this.late = args[0];
        return super.subscribe(...args);
    }
    public edit(): void { this.update(d => { d.rows[0].n++; }); }
}
const make = (): Store => new Store({rows: [{n: 0}], tick: 0});
const tracked = (store: Store): boolean => {
    const baseline = store.getVersion();
    store.edit();
    return store[CARBURETOR_PATHS_SINCE](baseline) !== undefined;
};

test('a captured hook notification after cleanup cannot reinstall subscriptions or acquire proofs', () => {
    const store = make();
    const Owner = (): React.ReactElement => {
        const rows = useCarburetorValue(store, d => d.rows);
        return <p>{rows[0].n}</p>;
    };
    const view = render(<Owner />);
    const late = store.late!;
    view.unmount();
    act(() => { late(); });
    expect(tracked(store)).toBe(false);
});

test('a suspended hook render cannot release the committed object selection on notification', () => {
    const store = make();
    const forever = new Promise<void>(() => undefined);
    const suspend = rstest.fn((): never => { throw forever; });
    const Owner = ({scalar}: {scalar: boolean}): React.ReactElement => {
        const selected = useCarburetorValue(store, d => scalar ? d.tick : d.rows);
        if (scalar) suspend();
        return <p>{Array.isArray(selected) ? selected[0].n : selected}</p>;
    };
    const view = render(<React.Suspense fallback={<p>loading</p>}><Owner scalar={false} /></React.Suspense>);
    act(() => {
        React.startTransition(() => {
            view.rerender(<React.Suspense fallback={<p>loading</p>}><Owner scalar /></React.Suspense>);
        });
    });
    expect(suspend).toHaveBeenCalled();
    const baseline = store.getVersion();
    act(() => { store.late!(); });
    act(() => { store.edit(); });
    expect(store[CARBURETOR_PATHS_SINCE](baseline)).toBeDefined();
    view.unmount();
    expect(tracked(store)).toBe(false);
});

test('an abandoned class render cannot overwrite the proof verdict restored by a replayed commit', () => {
    const store = make();
    class Owner extends AntiHookComponent {
        public scalar = false;
        private readonly selected = this.connectSelection(store, d => this.scalar ? d.tick : d.rows);
        public replay(): void { this.releaseSubscriptions(); this.commitSubscriptions(); }
        render() {
            const selected = this.selected();
            if (this.scalar) throw new Error('abandoned');
            return <p>{Array.isArray(selected) ? selected[0].n : selected}</p>;
        }
    }
    const ref = React.createRef<Owner>();
    const view = render(<Owner ref={ref} />);
    const owner = ref.current!;
    owner.scalar = true;
    expect(() => owner.render()).toThrow('abandoned');
    owner.scalar = false;
    act(() => { owner.replay(); });
    act(() => { expect(tracked(store)).toBe(true); });
    view.unmount();
    expect(tracked(store)).toBe(false);
});
