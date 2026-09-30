import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {Carburetor} from "@/Carburetor";
import {useCarburetorValue} from "@/Interop";

interface ITodoData {
    todo: {title: string; done: boolean};
}

class TodoCarburetor extends Carburetor<ITodoData> {
    /** Live registrations, independent of reconciliation call counts. */
    public get observerCount(): number { return Object.keys(this.subscribers).length; }

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

    test('changing comparison policy rechecks a suppressed value and retains truly equal snapshots', () => {
        const carburetor = new Carburetor<IProfileData>({name: 'old'});
        const select = (data: Readonly<IProfileData>) => ({title: data.name});
        const loose = () => true;
        const sameTitle = (a: {title: string}, b: {title: string}) => a.title === b.title;
        const seen: Array<{title: string}> = [];

        const NameView = ({isEqual}: {isEqual: (a: {title: string}, b: {title: string}) => boolean}) => {
            const value = useCarburetorValue(carburetor, select, isEqual);
            seen.push(value);

            return <span>{value.title}</span>;
        };

        const {container, rerender, unmount} = render(<NameView isEqual={loose}/>);
        const initial = seen[0];

        act(() => { carburetor.setData({name: 'new'}); });
        expect(container.textContent).toBe('old');

        rerender(<NameView isEqual={Object.is}/>);
        expect(container.textContent).toBe('new');
        const updated = seen[seen.length - 1];
        expect(updated).not.toBe(initial);

        rerender(<NameView isEqual={sameTitle}/>);
        expect(seen[seen.length - 1]).toBe(updated);

        rerender(<NameView isEqual={loose}/>);
        expect(seen[seen.length - 1]).toBe(updated);
        act(() => { carburetor.setData({name: 'newer'}); });
        expect(container.textContent).toBe('new');

        rerender(<NameView isEqual={sameTitle}/>);
        expect(container.textContent).toBe('newer');
        expect(seen[seen.length - 1]).not.toBe(updated);
        unmount();
    });

    test('comparator, source and selector switches keep one accurate live subscription', () => {
        const first = new TodoCarburetor({todo: {title: 'first', done: false}});
        const second = new TodoCarburetor({todo: {title: 'second', done: false}});
        const title = (data: Readonly<ITodoData>) => data.todo.title;
        const done = (data: Readonly<ITodoData>) => String(data.todo.done);
        const loose = () => true;
        let renders = 0;

        const View = ({source, select, isEqual}: {
            source: TodoCarburetor;
            select: typeof title;
            isEqual: (a: string, b: string) => boolean;
        }) => {
            renders++;

            return <span>{useCarburetorValue(source, select, isEqual)}</span>;
        };

        const {container, rerender, unmount} = render(<View source={first} select={title} isEqual={loose}/>);
        act(() => first.rename('changed'));
        expect(container.textContent).toBe('first');

        rerender(<View source={first} select={title} isEqual={Object.is}/>);
        expect(container.textContent).toBe('changed');
        expect(first.observerCount).toBe(1);

        rerender(<View source={first} select={done} isEqual={Object.is}/>);
        expect(container.textContent).toBe('false');
        expect(first.observerCount).toBe(1);
        const beforeUnrelated = renders;
        act(() => first.rename('ignored'));
        expect(renders).toBe(beforeUnrelated);
        act(() => first.markDone());
        expect(container.textContent).toBe('true');

        rerender(<View source={second} select={title} isEqual={Object.is}/>);
        expect(container.textContent).toBe('second');
        expect(first.observerCount).toBe(0);
        expect(second.observerCount).toBe(1);
        const beforeOldSource = renders;
        act(() => first.rename('obsolete'));
        expect(renders).toBe(beforeOldSource);
        act(() => second.rename('current'));
        expect(container.textContent).toBe('current');

        unmount();
        expect(first.observerCount).toBe(0);
        expect(second.observerCount).toBe(0);
    });
});
