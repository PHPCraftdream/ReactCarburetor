import * as React from 'react';
import {act} from 'react';
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
});
