import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {rstest} from '@rstest/core';
import {
    Carburetor,
    CarburetorProvider,
    CarburetorScope,
    carburetorToken,
    ScopedAntiHookComponent
} from '@/Carburetor';

interface IItem {
    n: number;
}

interface IQuizData {
    round: {options: IItem[]; target: IItem | null};
}

class Quiz extends Carburetor<IQuizData> {
    public set(options: IItem[], target: IItem | null = null): void {
        this.draft.round = {options, target};
        this.emitUpdate();
    }
}

const quizToken = carburetorToken<Quiz>(() => new Quiz({round: {options: [], target: null}}), 'alias-ledger/quiz');

class View extends ScopedAntiHookComponent {
    render() {
        const {round} = this.useCarburetor(this.resolve(quizToken));
        const items: React.ReactNode[] = [];

        for (let index = 0; index < round.options.length; index++) {
            items.push(<i key={index}>{round.options[index].n}</i>);
        }

        if (round.target !== null) {
            items.push(<b key="target">{round.target.n}</b>);
        }

        return <div>{items}</div>;
    }
}

describe('a component showing a round of shared objects', () => {
    let reported: string[] = [];
    let spy: {mockRestore: () => void} | undefined;

    beforeEach(() => {
        reported = [];
        spy = rstest.spyOn(console, 'error').mockImplementation((...args: unknown[]): void => {
            reported.push(String(args[0]));
        });
    });

    afterEach(() => {
        spy?.mockRestore();
    });

    const countAfter = (quiz: Quiz, options: IItem[], target: IItem | null = null): number => {
        const before = reported.length;

        act(() => quiz.set(options, target));

        return reported.length - before;
    };

    test('is quiet while shared objects change places, and still reports a real alias', () => {
        const [a, b, c] = [{n: 1}, {n: 2}, {n: 3}];
        const scope = new CarburetorScope();
        const quiz = scope.get(quizToken);
        const {container, unmount} = render(<CarburetorProvider scope={scope}><View/></CarburetorProvider>);

        expect(countAfter(quiz, [{n: 1}, {n: 2}])).toEqual(0);
        expect(countAfter(quiz, [{n: 2}, {n: 3}])).toEqual(0);
        expect(countAfter(quiz, [a, b])).toEqual(0);
        expect(countAfter(quiz, [b, a])).toEqual(0);
        expect(countAfter(quiz, [b, c])).toEqual(0);
        expect(container.querySelectorAll('i').length).toEqual(2);

        // The same object twice is a real alias: still reported, and only then.
        expect(countAfter(quiz, [a, a])).toBeGreaterThan(0);
        expect(countAfter(quiz, [c, b])).toEqual(0);
        expect(countAfter(quiz, [a, b], a)).toBeGreaterThan(0);

        for (const message of reported) {
            expect(message).toContain('the same object was reached at two paths');
        }

        unmount();
    });
});
