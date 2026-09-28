import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor, TPath} from '@/Carburetor';
import {TReadonly} from '@/Carburetor/Models/Base';

interface IBranch {
    title: string;
}

interface ITreeData {
    items: {a: IBranch; b: IBranch};
    list: Array<{n: number}>;
}

const getTreeData = (): ITreeData => ({
    items: {a: {title: 'first'}, b: {title: 'second'}},
    list: [{n: 1}, {n: 2}],
});

class TreeCarburetor extends Carburetor<ITreeData> {
    /** Writes a leaf under items.a through draft. */
    public setATitle = (title: string): void => {
        this.update((draft: ITreeData) => {
            draft.items.a.title = title;
        });
    };
}

describe('structural mutation is rejected at every read-proxy level (R2-12)', () => {
    test('the root view refuses a prototype change and an extension change', () => {
        const carburetor = new TreeCarburetor(getTreeData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        const raw = carburetor.getData();

        // Without traps of their own, setPrototypeOf and preventExtensions would land straight
        // on the raw backing object the read proxy fronts.
        expect(() => {
            Object.setPrototypeOf(view, null);
        }).toThrow(/read-only/);
        expect(Object.getPrototypeOf(raw)).toBe(Object.prototype);

        expect(() => {
            Object.preventExtensions(view);
        }).toThrow(/read-only/);
        expect(Object.isExtensible(raw)).toBe(true);
    });

    test('a nested branch view refuses them too, and reads and writes keep working afterwards', () => {
        const carburetor = new TreeCarburetor(getTreeData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        const rawBranch = carburetor.getData().items.a;

        const nested = view.items.a;

        // Every level of the read tree is a read proxy, so the nested branch refuses exactly
        // like the root does — against the raw object it fronts, not some copy.
        expect(() => {
            Object.setPrototypeOf(nested, null);
        }).toThrow(/read-only/);
        expect(Object.getPrototypeOf(rawBranch)).toBe(Object.prototype);

        expect(() => {
            Object.preventExtensions(nested);
        }).toThrow(/read-only/);
        expect(Object.isExtensible(rawBranch)).toBe(true);

        // Nothing the refused attempts would have changed survived: the view still answers
        // from the same live data.
        expect(view.items.a.title).toEqual('first');

        carburetor.setATitle('edited');

        // A normal draft write still reaches the view, so the rejections poisoned nothing.
        expect(view.items.a.title).toEqual('edited');
    });

    test('a refused structural mutation never poisons a component view', () => {
        const store = new TreeCarburetor(getTreeData());
        let captured: unknown = undefined;

        class TitleView extends AntiHookComponent {
            private readonly connection = this.connect(() => store);

            public render() {
                const view = this.connection;

                captured = view;

                const title = view.items.a ? view.items.a.title : view.items.b.title;

                return React.createElement('div', {className: 'title'}, title);
            }
        }

        const {container, unmount} = render(React.createElement(TitleView));

        expect(container.querySelector('.title')?.textContent).toEqual('first');

        // The facade forwards every get onto the read proxies below it, so captured.items is
        // the nested read proxy over the raw items object — the level the facade alone misses.
        const nested = (captured as TReadonly<ITreeData>).items;
        const rawItems = store.getData().items;

        expect(() => {
            Object.setPrototypeOf(nested, null);
        }).toThrow(/read-only/);
        expect(Object.getPrototypeOf(rawItems)).toBe(Object.prototype);

        expect(() => {
            Object.preventExtensions(nested);
        }).toThrow(/read-only/);
        expect(Object.isExtensible(rawItems)).toBe(true);

        act(() => store.setATitle('edited'));

        // The component re-rendered and re-read, so the write still reaches it.
        expect(container.querySelector('.title')?.textContent).toEqual('edited');

        unmount();
    });
});
