import {RuleTester} from "oxlint/plugins-dev";
import {noUntrackableStoreData} from "@plugin/Rules/Boundaries/noUntrackableStoreData.mts";

const rule = noUntrackableStoreData as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'ts'}}});

tester.run('no-untrackable-store-data', rule, {
    valid: [
        {
            name: 'plain data in the store',
            code: `interface ITodoList {
                items: Record<string, ITodo>;
                orderIds: string[];
            }

            class TodoCarburetor extends Carburetor<ITodoList> {
            }`,
        },
        {
            name: 'a Map outside any store',
            code: `interface ICache {
                index: Map<string, number>;
            }`,
        },
        {
            name: 'a Map in a local variable of a store method',
            code: `interface IData {
                items: string[];
            }

            class TodoCarburetor extends Carburetor<IData> {
                public rebuild = () => {
                    const index: Map<string, number> = new Map();

                    return index;
                };
            }`,
        },
        {
            name: 'a Date allowed through options',
            code: `interface IData {
                when: Date;
            }

            class TodoCarburetor extends Carburetor<IData> {
            }`,
            options: [{allowedTypes: ['Date']}],
        },
        {
            name: 'a Map built by something that is not an initial-data factory',
            code: `export const buildCache = () => ({index: new Map()});`,
        },
    ],
    invalid: [
        {
            name: 'a Map in the store data interface',
            code: `interface IData {
                index: Map<string, number>;
            }

            class TodoCarburetor extends Carburetor<IData> {
            }`,
            errors: [{message: /not tracked field by field/, line: 2}],
        },
        {
            name: 'a Date and a Set in the same interface',
            code: `interface IData {
                when: Date;
                seen: Set<string>;
            }

            class TodoCarburetor extends Carburetor<IData> {
            }`,
            errors: 2,
        },
        {
            name: 'a Map built by an initial-data factory',
            code: `export const getInitialData = () => ({
                items: {},
                index: new Map(),
            });`,
            errors: 1,
        },
        {
            name: 'a Map handed to super as initial data',
            code: `class TodoCarburetor extends Carburetor {
                constructor() {
                    super({items: {}, index: new Map()});
                }
            }`,
            errors: 1,
        },
        {
            name: 'a resource subclass parameterised with the same shape',
            code: `interface IData {
                index: Map<string, number>;
            }

            class TodoResource extends ResourceCarburetor<IData> {
            }`,
            errors: 1,
        },
    ],
});
