import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';
import {CARBURETOR_HAS_DRIFT} from '@/Carburetor/Store/Utils/Models';
import {ReadStore} from '../r40-02/ReadStore';

for (const sameLive of [true, false]) {
    test(`R40-02 class fallback preserves own presence (same live: ${sameLive})`, () => {
        const store = new ReadStore();
        Object.defineProperty(store, CARBURETOR_HAS_DRIFT, {value: undefined});
        let narrow = false;
        let bump!: () => void;
        let renders = 0;
        class Reader extends AntiHookComponent {
            private readonly row = this.connectSelection(store, data => {
                if (!narrow) void data.user?.name;
                const present = !!data.user;
                return data.items[present && (!narrow || sameLive) ? 'r0' : 'r1'];
            });
            private readonly bump = (): void => this.forceUpdate();
            render(): React.ReactNode {
                renders++;
                bump = this.bump;
                return <p>{this.row().title}</p>;
            }
        }
        const view = render(<Reader />);
        expect(store.filed[0]).toContain('user.name');
        narrow = true;
        act(bump);
        const filed = store.filed.at(-1)!;
        const before = renders;
        act(() => { store.change(data => { data.user = undefined; }); });
        // Assert delivery before inspecting the set, so the regression observes the missed wake.
        expect(renders).toBeGreaterThan(before);
        expect(filed).toContain('user.~p');
        expect(filed).not.toContain('user.name');
        expect(view.container.textContent).toBe('t1');
        view.unmount();
    });
}

test('R40-02 hook fallback files own marker, not coverage from the previous selection', () => {
    const store = new ReadStore();
    Object.defineProperty(store, CARBURETOR_HAS_DRIFT, {value: undefined});
    let narrow = false;
    let bump!: () => void;
    let calls = 0;
    const Reader = (): React.ReactElement => {
        const [, setTick] = React.useState(0);
        React.useLayoutEffect(() => { bump = () => setTick(tick => tick + 1); }, []);
        const value = useCarburetorValue(store, data => {
            calls++;
            if (!narrow) void data.user?.name;
            const present = !!data.user;
            return data.items[present ? (narrow ? 'r1' : 'r0') : 'r2'];
        });
        return <p>{value.title}</p>;
    };
    const view = render(<Reader />);
    expect(store.filed[0]).toContain('user.name');
    narrow = true;
    act(bump);
    // Advance the version without touching the selected tree; drift fallback is disabled.
    act(() => { store.change(data => { data.user = {name: 'replacement'}; }); });
    const filed = store.filed.at(-1)!;
    expect(filed).toContain('user.~p');
    expect(filed).not.toContain('user.name');
    const before = calls;
    act(() => { store.change(data => { data.user = undefined; }); });
    expect(calls).toBeGreaterThan(before);
    expect(view.container.textContent).toBe('t2');
    view.unmount();
});
