import * as React from 'react';
import {render} from '@testing-library/react';
import {Carburetor} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';

class TaggedMap extends Map<string, number> {
    #tag: string;

    public constructor(tag: string, entries: [string, number][]) {
        super(entries);
        this.#tag = tag;
    }

    public tag(): string {
        return this.#tag;
    }
}

class TaggedSet extends Set<string> {
    #tag: string;

    public constructor(tag: string, members: string[]) {
        super(members);
        this.#tag = tag;
    }

    public tag(): string {
        return this.#tag;
    }
}

class TaggedDate extends Date {
    #tag: string;

    public constructor(tag: string, time: number) {
        super(time);
        this.#tag = tag;
    }

    public tag(): string {
        return this.#tag;
    }
}

interface IBuiltinSubclassData {
    taggedMap: TaggedMap;
    taggedSet: TaggedSet;
    taggedDate: TaggedDate;
}

const getBuiltinSubclassData = (): IBuiltinSubclassData => ({
    taggedMap: new TaggedMap('m', [['a', 1]]),
    taggedSet: new TaggedSet('s', ['x']),
    taggedDate: new TaggedDate('d', 1000),
});

class BuiltinSubclassCarburetor extends Carburetor<IBuiltinSubclassData> {}

class SelectorErrorBoundary extends React.Component<
    {children: React.ReactNode},
    {message: string | null}
> {
    public state = {message: null as string | null};

    public static getDerivedStateFromError(error: unknown): {message: string} {
        return {message: error instanceof Error ? error.message : String(error)};
    }

    public render(): React.ReactNode {
        return this.state.message
            ? <div role="alert">{this.state.message}</div>
            : this.props.children;
    }
}

const expectBuiltinSubclassSelectorError = (
    select: (data: IBuiltinSubclassData) => unknown,
    className: string
): void => {
    const carburetor = new BuiltinSubclassCarburetor(getBuiltinSubclassData());

    const ValueView = () => {
        const value = useCarburetorValue(carburetor, select);

        return <div>{String(value)}</div>;
    };

    const original = console.error;

    console.error = () => undefined;

    try {
        const {container, unmount} = render(
            <SelectorErrorBoundary><ValueView/></SelectorErrorBoundary>
        );

        expect(container.querySelector('[role="alert"]')?.textContent)
            .toContain('useCarburetorValue() cannot select a live ' + className + ' instance');
        expect(container.textContent).toContain('Select the fields the component renders');

        unmount();
    } finally {
        console.error = original;
    }
};

describe('built-in subclass selector results (R12-02)', () => {
    test('a Map subclass fails through an error boundary instead of downgrading to a plain Map', () => {
        expectBuiltinSubclassSelectorError((data) => data.taggedMap, 'TaggedMap');
    });

    test('a Set subclass fails through an error boundary instead of downgrading to a plain Set', () => {
        expectBuiltinSubclassSelectorError((data) => data.taggedSet, 'TaggedSet');
    });

    test('a Date subclass fails through an error boundary instead of downgrading to a plain Date', () => {
        expectBuiltinSubclassSelectorError((data) => data.taggedDate, 'TaggedDate');
    });

    test('a Map subclass nested inside a plain object also fails through an error boundary', () => {
        expectBuiltinSubclassSelectorError((data) => ({taggedMap: data.taggedMap}), 'TaggedMap');
    });

    test('plain Map, Set and Date controls are still copied and detached, not rejected', () => {
        const carburetor = new BuiltinSubclassCarburetor({
            taggedMap: new TaggedMap('m', [['a', 1]]),
            taggedSet: new TaggedSet('s', ['x']),
            taggedDate: new TaggedDate('d', 1000),
        });
        const plainMap = new Map([['a', 1]]);
        const plainSet = new Set(['x']);
        const plainDate = new Date(1000);
        const seen: Array<{map: Map<string, number>; set: Set<string>; date: Date}> = [];

        const View = () => {
            const value = useCarburetorValue(carburetor, () => ({map: plainMap, set: plainSet, date: plainDate}));

            seen.push(value);

            return <div className="value">{value.map.get('a')}:{value.set.size}:{value.date.getTime()}</div>;
        };

        const {container, unmount} = render(<View/>);

        expect(container.querySelector('.value')?.textContent).toEqual('1:1:1000');
        expect(seen[0].map).not.toBe(plainMap);
        expect(seen[0].set).not.toBe(plainSet);
        expect(seen[0].date).not.toBe(plainDate);

        unmount();
    });
});
