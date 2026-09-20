import {RuleTester} from "oxlint/plugins-dev";
import {noUntrackableDraftMutation} from "@plugin/Rules/Writes/noUntrackableDraftMutation.mts";

const rule = noUntrackableDraftMutation as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'ts'}}});

tester.run('no-untrackable-draft-mutation', rule, {
    valid: [
        {
            name: 'replacing the value keeps the usual precision',
            code: `class IndexCarburetor extends Carburetor {
                public setIndex = (next: Map<string, number>) => {
                    this.draft.index = next;

                    this.emitUpdate();
                };
            }`,
        },
        {
            name: 'an in-place array change is tracked and is not this rule\'s business',
            code: `class IndexCarburetor extends Carburetor {
                public addId = (id: string) => {
                    this.draft.orderIds.push(id);

                    this.emitUpdate();
                };
            }`,
        },
        {
            name: 'a map mutated outside a carburetor',
            code: `const cache = new Map(); cache.set('a', 1);`,
        },
        {
            name: 'a mutating method on a store reached some other way',
            code: `class IndexCarburetor extends Carburetor {
                public warm = () => {
                    this.cache.set('a', 1);
                };
            }`,
        },
    ],
    invalid: [
        {
            name: 'set on a map reached through this.draft',
            code: `class IndexCarburetor extends Carburetor {
                public put = (key: string, value: number) => {
                    this.draft.index.set(key, value);

                    this.emitUpdate();
                };
            }`,
            errors: [{message: /cannot wrap/, line: 3}],
        },
        {
            name: 'set on a map reached through the update draft',
            code: `class IndexCarburetor extends Carburetor {
                public put = (key: string, value: number) => {
                    this.update(draft => {
                        draft.index.set(key, value);
                    });
                };
            }`,
            errors: 1,
        },
        {
            name: 'clear on a set reached through draft',
            code: `class IndexCarburetor extends Carburetor {
                public reset = () => {
                    this.draft.seen.clear();

                    this.emitUpdate();
                };
            }`,
            errors: 1,
        },
        {
            name: 'mutating a Date through draft',
            code: `class IndexCarburetor extends Carburetor {
                public touch = () => {
                    this.draft.when.setTime(Date.now());

                    this.emitUpdate();
                };
            }`,
            errors: 1,
        },
        {
            name: 'a method name added through options',
            code: `class IndexCarburetor extends Carburetor {
                public enqueue = (item: string) => {
                    this.draft.queue.enqueue(item);

                    this.emitUpdate();
                };
            }`,
            options: [{mutatingMethods: ['enqueue']}],
            errors: 1,
        },
    ],
});
