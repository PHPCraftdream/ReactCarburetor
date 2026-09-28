import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {Carburetor} from "@/Carburetor";
import {useCarburetorValue} from "@/Interop";

interface ITodoData {
    todo: {title: string; done: boolean};
}

class TodoCarburetor extends Carburetor<ITodoData> {
    /** Replaces the whole `todo` object — an ancestor of `title` — keeping the title as is. */
    public markDone = () => {
        this.draft.todo = {...this.draft.todo, done: true};

        this.emitUpdate();
    };

    public rename = (title: string) => {
        this.update((draft: ITodoData) => {
            draft.todo.title = title;
        });
    };
}

interface IProfileData {
    name: string;
}

describe('useCarburetorValue default comparator', () => {
    test('an ancestor rewrite that keeps the selected content equal does not re-render', () => {
        const carburetor = new TodoCarburetor({todo: {title: 'shopping', done: false}});
        let renders = 0;

        const TitleView = () => {
            renders++;

            const value = useCarburetorValue(carburetor, (data) => ({title: data.todo.title}));

            return <div className="title">{value.title}</div>;
        };

        const {container, unmount} = render(<TitleView/>);

        expect(container.querySelector('.title')?.textContent).toEqual('shopping');
        const afterMount = renders;

        // The write replaces the whole `todo` object and notifies through that ancestor path,
        // but the selected title is unchanged.
        act(() => carburetor.markDone());

        expect(renders).toEqual(afterMount);
        expect(container.querySelector('.title')?.textContent).toEqual('shopping');

        unmount();
    });

    test('an inline selector recreated every render keeps a stable reference while content is unchanged', () => {
        const carburetor = new Carburetor<IProfileData>({name: 'ann'});
        const seen: Array<{title: string}> = [];
        let selectorCalls = 0;

        const NameView = ({tick}: {tick: number}) => {
            const value = useCarburetorValue(carburetor, (data) => {
                selectorCalls++;

                return {title: data.name};
            });

            seen.push(value);

            return <div className="value">{value.title}:{tick}</div>;
        };

        const {container, rerender, unmount} = render(<NameView tick={0}/>);

        expect(container.querySelector('.value')?.textContent).toEqual('ann:0');
        expect(seen.length).toEqual(1);
        expect(selectorCalls).toEqual(1);

        // No store write: only the parent re-renders, handing in a brand-new selector closure.
        rerender(<NameView tick={1}/>);

        expect(container.querySelector('.value')?.textContent).toEqual('ann:1');
        // The selector runs once per render — bounded, not repeated — but the store version
        // never moved, so the selected content is unchanged.
        expect(selectorCalls).toEqual(2);
        expect(seen[1]).toBe(seen[0]);

        unmount();
    });

    test('a custom comparator receives detached values, never the live branch', () => {
        const carburetor = new TodoCarburetor({todo: {title: 'shopping', done: false}});
        const compared: Array<{title: string}> = [];
        const isEqual = (a: {title: string}, b: {title: string}): boolean => {
            compared.push(b);

            return a.title === b.title;
        };

        const TodoView = ({tick}: {tick: number}) => {
            const value = useCarburetorValue(carburetor, (data) => data.todo, isEqual);

            return <div className="todo">{value.title}:{tick}</div>;
        };

        const {rerender, unmount} = render(<TodoView tick={0}/>);

        // A new selector closure at an unchanged version runs the comparator.
        rerender(<TodoView tick={1}/>);

        expect(compared.length).toEqual(1);

        act(() => carburetor.rename('errands'));

        // A live branch would now read the new title.
        expect(compared[0].title).toEqual('shopping');

        unmount();
    });
});
