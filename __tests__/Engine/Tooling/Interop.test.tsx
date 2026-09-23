import * as React from 'react';
import {act, StrictMode} from 'react';
import {render} from '@testing-library/react';
import {Carburetor, computed} from "@/Carburetor";
import {useCarburetorValue, useComputedValue} from "@/Interop";

interface IProfileData {
    name: string;
    age: number;
    tags: string[];
}

const getData = (): IProfileData => ({name: 'ann', age: 30, tags: ['a']});

class ProfileCarburetor extends Carburetor<IProfileData> {
    public setName = (name: string) => {
        this.draft.name = name;

        this.emitUpdate();
    };

    public setAge = (age: number) => {
        this.draft.age = age;

        this.emitUpdate();
    };
}

interface IBranchData {
    which: boolean;
    a: string;
    b: string;
}

interface INestedData {
    user: {name: string; age: number};
    other: number;
}

class BranchCarburetor extends Carburetor<IBranchData> {
    public setWhich = (which: boolean) => {
        this.draft.which = which;

        this.emitUpdate();
    };

    public setA = (a: string) => {
        this.draft.a = a;

        this.emitUpdate();
    };

    public setB = (b: string) => {
        this.draft.b = b;

        this.emitUpdate();
    };
}

class NestedCarburetor extends Carburetor<INestedData> {
    public renameUser = (name: string) => {
        this.draft.user.name = name;

        this.emitUpdate();
    };

    public bumpOther = () => {
        this.draft.other += 1;

        this.emitUpdate();
    };
}

interface IIndexedData {
    index: Map<string, number>;
    title: string;
}

const getIndexData = (): IIndexedData => ({index: new Map([['a', 1]]), title: 't'});

class IndexedCarburetor extends Carburetor<IIndexedData> {
    public setIndex = (key: string, value: number) => {
        this.draft.index.set(key, value);

        this.emitUpdate();
    };

    public setTitle = (title: string) => {
        this.draft.title = title;

        this.emitUpdate();
    };
}

describe('hooks interop', () => {
    test('a function component reads a carburetor and re-renders on change', () => {
        const carburetor = new ProfileCarburetor(getData());
        let renders = 0;

        const NameView = () => {
            renders++;
            const name = useCarburetorValue(carburetor, (data) => data.name);

            return <div className="name">{name}</div>;
        };

        const {container, unmount} = render(<NameView/>);

        expect(container.querySelector('.name')?.textContent).toEqual('ann');
        const initialRenders = renders;

        act(() => carburetor.setName('bob'));
        expect(container.querySelector('.name')?.textContent).toEqual('bob');
        expect(renders).toBeGreaterThan(initialRenders);

        unmount();
    });

    test('the selector read paths become the subscription', () => {
        const carburetor = new ProfileCarburetor(getData());
        let renders = 0;

        const NameView = () => {
            renders++;
            const name = useCarburetorValue(carburetor, (data) => data.name);

            return <div className="name">{name}</div>;
        };

        const {unmount} = render(<NameView/>);
        const afterMount = renders;

        // age is not part of the selector, so nothing should re-render.
        act(() => carburetor.setAge(31));
        expect(renders).toEqual(afterMount);

        act(() => carburetor.setName('bob'));
        expect(renders).toBeGreaterThan(afterMount);

        unmount();
    });

    test('a selector building a new object stays stable while data does not change', () => {
        const carburetor = new ProfileCarburetor(getData());
        const seen: Array<{name: string}> = [];

        const select = (data: {name: string}) => ({name: data.name});
        const isEqual = (a: {name: string}, b: {name: string}) => a.name === b.name;

        const NameView = () => {
            const value = useCarburetorValue(carburetor, select, isEqual);
            seen.push(value);

            return <div className="name">{value.name}</div>;
        };

        const {container, unmount} = render(<NameView/>);

        act(() => carburetor.setAge(31));

        // No extra render, and no fresh object identity either.
        expect(seen.length).toEqual(1);
        expect(container.querySelector('.name')?.textContent).toEqual('ann');

        unmount();
    });

    test('a function component reads a computed', () => {
        const carburetor = new ProfileCarburetor(getData());

        const label = computed<string>((read) => {
            const data = read(carburetor);

            return data.name + ':' + data.age;
        });

        const LabelView = () => {
            return <div className="label">{useComputedValue(label)}</div>;
        };

        const {container, unmount} = render(<LabelView/>);

        expect(container.querySelector('.label')?.textContent).toEqual('ann:30');

        act(() => carburetor.setAge(31));
        expect(container.querySelector('.label')?.textContent).toEqual('ann:31');

        unmount();
    });

    test('a new selector invalidates the cached snapshot without a store write', () => {
        const carburetor = new ProfileCarburetor(getData());

        const selectName = (data: IProfileData) => data.name;
        const selectAge = (data: IProfileData) => String(data.age);

        const ValueView = ({select}: {select: (data: IProfileData) => string}) => {
            const value = useCarburetorValue(carburetor, select);

            return <div className="value">{value}</div>;
        };

        const {container, rerender, unmount} = render(<ValueView select={selectName}/>);

        expect(container.querySelector('.value')?.textContent).toEqual('ann');

        // No write happens: only the selector identity changes.
        rerender(<ValueView select={selectAge}/>);
        expect(container.querySelector('.value')?.textContent).toEqual('30');

        unmount();
    });

    test('a new carburetor invalidates the cached snapshot without a store write', () => {
        const first = new ProfileCarburetor(getData());
        const second = new ProfileCarburetor({name: 'kate', age: 40, tags: []});

        const selectName = (data: IProfileData) => data.name;

        const NameView = ({carburetor}: {carburetor: ProfileCarburetor}) => {
            const name = useCarburetorValue(carburetor, selectName);

            return <div className="name">{name}</div>;
        };

        const {container, rerender, unmount} = render(<NameView carburetor={first}/>);

        expect(container.querySelector('.name')?.textContent).toEqual('ann');

        // No write happens: both stores may even sit at the same version.
        rerender(<NameView carburetor={second}/>);
        expect(container.querySelector('.name')?.textContent).toEqual('kate');

        unmount();
    });

    test('a selector whose read path flips at runtime is re-subscribed to the new path', () => {
        const carburetor = new BranchCarburetor({which: true, a: 'alpha', b: 'beta'});

        // Stable across renders: a fresh closure every render would re-install the
        // subscription through React and mask exactly the bug under test.
        const selectBranch = (data: IBranchData) => (data.which ? data.a : data.b);

        const BranchView = () => {
            const value = useCarburetorValue(carburetor, selectBranch);

            return <div className="value">{value}</div>;
        };

        const {container, unmount} = render(<BranchView/>);

        expect(container.querySelector('.value')?.textContent).toEqual('alpha');

        // The flip itself is observed through the old read set, which still contains `which`.
        act(() => carburetor.setWhich(false));
        expect(container.querySelector('.value')?.textContent).toEqual('beta');

        // Only the new read set contains `b`: without reconciliation this write wakes nobody.
        act(() => carburetor.setB('gamma'));
        expect(container.querySelector('.value')?.textContent).toEqual('gamma');

        unmount();
    });

    test('an object-valued selector watches its branch and hands out detached snapshots', () => {
        const carburetor = new NestedCarburetor({user: {name: 'ann', age: 30}, other: 0});
        const snapshots: Array<{name: string; age: number}> = [];

        const UserView = () => {
            const user = useCarburetorValue(carburetor, (data) => data.user);

            snapshots.push(user);

            return <div className="name">{user.name}</div>;
        };

        const {container, unmount} = render(<UserView/>);

        expect(container.querySelector('.name')?.textContent).toEqual('ann');
        const first = snapshots[0];

        act(() => carburetor.renameUser('bob'));
        expect(container.querySelector('.name')?.textContent).toEqual('bob');

        // The earlier snapshot is a detached copy: it did not mutate with the store.
        expect(first.name).toEqual('ann');

        // The subscription is the branch, not the whole store: a sibling write wakes nobody.
        const rendersBeforeSibling = snapshots.length;
        act(() => carburetor.bumpOther());
        expect(snapshots.length).toEqual(rendersBeforeSibling);

        unmount();
    });

    test('the subscription follows a flipped read path even when the value stays equal', () => {
        const carburetor = new BranchCarburetor({which: true, a: 'same', b: 'same'});
        const selectBranch = (data: IBranchData) => (data.which ? data.a : data.b);
        let renders = 0;

        const BranchView = () => {
            renders++;

            const value = useCarburetorValue(carburetor, selectBranch);

            return <div className="value">{value}</div>;
        };

        const {container, unmount} = render(<BranchView/>);
        const afterMount = renders;

        // `a` and `b` hold the same string: the flip must not re-render the component.
        act(() => carburetor.setWhich(false));
        expect(renders).toEqual(afterMount);
        expect(container.querySelector('.value')?.textContent).toEqual('same');

        // But the subscription must have moved to `b`, or this write goes unnoticed.
        act(() => carburetor.setB('changed'));
        expect(renders).toEqual(afterMount + 1);
        expect(container.querySelector('.value')?.textContent).toEqual('changed');

        unmount();
    });

    test('a StrictMode remount keeps exactly one working subscription', () => {
        const carburetor = new ProfileCarburetor(getData());

        const NameView = () => {
            const name = useCarburetorValue(carburetor, (data) => data.name);

            return <div className="name">{name}</div>;
        };

        const {container, unmount} = render(<StrictMode><NameView/></StrictMode>);

        expect(container.querySelector('.name')?.textContent).toEqual('ann');

        act(() => carburetor.setName('bob'));
        expect(container.querySelector('.name')?.textContent).toEqual('bob');

        unmount();
    });

    test('a Map-valued selector re-renders after an in-place mutation and snapshots stay detached (R6-03)', () => {
        const carburetor = new IndexedCarburetor(getIndexData());
        let renders = 0;
        const seen: Array<Map<string, number>> = [];

        const IndexView = () => {
            renders++;

            const index = useCarburetorValue(carburetor, (data) => data.index);

            seen.push(index);

            return <div className="value">{index.get('a')}</div>;
        };

        const {container, unmount} = render(<IndexView/>);

        expect(container.querySelector('.value')?.textContent).toEqual('1');
        expect(seen.length).toEqual(1);

        const firstSnapshot = seen[0];

        act(() => carburetor.setIndex('a', 2));

        expect(container.querySelector('.value')?.textContent).toEqual('2');
        expect(renders).toBeGreaterThan(1);
        // The earlier snapshot is a detached copy: it did not mutate with the store.
        expect(firstSnapshot.get('a')).toEqual(1);

        unmount();
    });

    test('a primitive selector on the same store is not woken by an unrelated Map write (R6-03 control)', () => {
        const carburetor = new IndexedCarburetor(getIndexData());
        let renders = 0;

        const TitleView = () => {
            renders++;

            const title = useCarburetorValue(carburetor, (data) => data.title);

            return <div className="title">{title}</div>;
        };

        const {container, unmount} = render(<TitleView/>);
        const afterMount = renders;

        act(() => carburetor.setIndex('a', 2));
        expect(renders).toEqual(afterMount);
        expect(container.querySelector('.title')?.textContent).toEqual('t');

        act(() => carburetor.setTitle('u'));
        expect(renders).toBeGreaterThan(afterMount);
        expect(container.querySelector('.title')?.textContent).toEqual('u');

        unmount();
    });
});
