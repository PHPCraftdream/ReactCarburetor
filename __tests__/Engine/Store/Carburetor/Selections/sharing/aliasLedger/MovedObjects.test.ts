import {rstest} from '@rstest/core';
import {Carburetor} from '@/Carburetor';

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

    public bump(index: number): void {
        this.update((draft: IQuizData) => {
            draft.round.options[index].n++;
        });
    }

    /** The reads one render of a component showing the round makes. */
    public look(): void {
        const {round} = this.read(() => undefined);

        for (let index = 0; index < round.options.length; index++) {
            void round.options[index].n;
        }

        if (round.target !== null) {
            void round.target.n;
        }
    }
}

const reportsOf = (run: () => void): string[] => {
    const messages: string[] = [];
    const spy = rstest.spyOn(console, 'error').mockImplementation((...args: unknown[]): void => {
        messages.push(String(args[0]));
    });

    try {
        run();
    } finally {
        spy.mockRestore();
    }

    return messages;
};

const lookAfter = (quiz: Quiz, options: IItem[], target: IItem | null = null): string[] =>
    reportsOf(() => {
        quiz.set(options, target);
        quiz.look();
    });

describe('an object that left its path is not reported at a second one', () => {
    test('fresh objects every round never report', () => {
        const quiz = new Quiz({round: {options: [], target: null}});

        expect(lookAfter(quiz, [{n: 1}, {n: 2}])).toEqual([]);
        expect(lookAfter(quiz, [{n: 2}, {n: 3}])).toEqual([]);
    });

    test('shared objects that swap places and shift between rounds never report', () => {
        const [a, b, c] = [{n: 1}, {n: 2}, {n: 3}];
        const quiz = new Quiz({round: {options: [], target: null}});

        expect(lookAfter(quiz, [a, b])).toEqual([]);
        expect(lookAfter(quiz, [b, a])).toEqual([]);
        expect(lookAfter(quiz, [b, c])).toEqual([]);
        expect(lookAfter(quiz, [c, b, a])).toEqual([]);
    });

    test('the same object twice in one round is still reported', () => {
        const a = {n: 1};
        const quiz = new Quiz({round: {options: [], target: null}});

        const messages = lookAfter(quiz, [a, a]);

        expect(messages.length).toBeGreaterThan(0);

        for (const message of messages) {
            expect(message).toContain('the same object was reached at two paths');
        }
    });

    test('a target that is also an option is reported once, whatever the earlier rounds left behind', () => {
        const [a, b] = [{n: 1}, {n: 2}];
        const quiz = new Quiz({round: {options: [], target: null}});

        lookAfter(quiz, [a, b]);
        lookAfter(quiz, [b, a]);
        lookAfter(quiz, [a, a]);

        const messages = lookAfter(quiz, [a, b], a);

        expect(messages.length).toEqual(1);
        expect(messages[0]).toContain('round.options.0 and round.target');
    });

    test('a whole-state replacement does not carry the old paths over', () => {
        const [a, b] = [{n: 1}, {n: 2}];
        const quiz = new Quiz({round: {options: [a, b], target: null}});

        expect(reportsOf(() => quiz.look())).toEqual([]);

        const messages = reportsOf(() => {
            quiz.setData({round: {options: [b, a], target: null}});
            quiz.look();
        });

        expect(messages).toEqual([]);
    });

    test('a write into an object that moved is not "also read" at its old path', () => {
        const [a, b] = [{n: 1}, {n: 2}];
        const quiz = new Quiz({round: {options: [], target: null}});

        lookAfter(quiz, [a, b]);

        const messages = reportsOf(() => {
            quiz.set([b, a]);
            quiz.bump(0);
        });

        expect(messages).toEqual([]);
        expect(b.n).toEqual(3);
    });

    test('a write into an object still read at another path is still reported', () => {
        const a = {n: 1};
        const quiz = new Quiz({round: {options: [], target: null}});

        lookAfter(quiz, [a, a]);

        const messages = reportsOf(() => quiz.bump(0));

        expect(messages.length).toBeGreaterThan(0);

        for (const message of messages) {
            expect(message).toContain('also read at');
        }
    });
});

interface ITreeData {
    left: {leaf: IItem} | null;
    right: {leaf: IItem} | null;
}

class Tree extends Carburetor<ITreeData> {
    public moveRight(): void {
        this.update((draft: ITreeData) => {
            const leaf = this.getData().left?.leaf as IItem;

            draft.right = {leaf};
            draft.left = null;
        });
    }

    public look(): void {
        const data = this.read(() => undefined);

        void data.left?.leaf.n;
        void data.right?.leaf.n;
    }
}

describe('a branch moved out of its parent', () => {
    test('the leaf it carried to a new parent is not reported at the old one', () => {
        const leaf = {n: 1};
        const tree = new Tree({left: {leaf}, right: null});

        expect(reportsOf(() => tree.look())).toEqual([]);
        expect(reportsOf(() => {
            tree.moveRight();
            tree.look();
        })).toEqual([]);
    });
});

type TDottedData = Record<string, {leaf: IItem}>;

class Dotted extends Carburetor<{flat: TDottedData; nested: Record<string, TDottedData>}> {
    public look(): void {
        const data = this.read(() => undefined);

        void data.flat['x.y'].leaf.n;
        void data.nested.x.y.leaf.n;
    }
}

describe('separators and tildes in keys', () => {
    test('a dotted key that still holds the object keeps the alias reported', () => {
        const leaf = {n: 1};
        const dotted = new Dotted({flat: {'x.y': {leaf}}, nested: {x: {y: {leaf}}}});

        const messages = reportsOf(() => dotted.look());

        expect(messages.length).toEqual(1);
        expect(messages[0]).toContain('x~1y.leaf');
    });

    test('a dotted key that no longer holds the object stays silent', () => {
        const [first, second] = [{n: 1}, {n: 2}];
        const dotted = new Dotted({flat: {'x.y': {leaf: first}}, nested: {x: {y: {leaf: second}}}});

        expect(reportsOf(() => dotted.look())).toEqual([]);

        const messages = reportsOf(() => {
            dotted.setData({flat: {'x.y': {leaf: second}}, nested: {x: {y: {leaf: first}}}});
            dotted.look();
        });

        expect(messages).toEqual([]);
    });
});
