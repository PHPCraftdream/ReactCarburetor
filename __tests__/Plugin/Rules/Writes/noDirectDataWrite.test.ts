import {RuleTester} from "oxlint/plugins-dev";
import {noDirectDataWrite} from "@plugin/Rules/Writes/noDirectDataWrite.mts";

const rule = noDirectDataWrite as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'ts'}}});

tester.run('no-direct-data-write', rule, {
    valid: [
        {
            name: 'writing through draft',
            code: `class TodoCarburetor extends Carburetor {
                public setTitle = (title: string) => {
                    this.draft.title = title;

                    this.emitUpdate();
                };
            }`,
        },
        {
            name: 'reading this.data without writing it',
            code: `class TodoCarburetor extends Carburetor {
                public getTitle = (): string => {
                    return this.data.title;
                };
            }`,
        },
        {
            name: 'a field called data on a class that is not a carburetor',
            code: `class Editor {
                public reset = () => {
                    this.data.title = '';
                };
            }`,
        },
        {
            name: 'replacing the whole state through setData',
            code: `class TodoCarburetor extends Carburetor {
                public reset = () => {
                    this.setData(getInitialData());
                };
            }`,
        },
    ],
    invalid: [
        {
            name: 'assigning a field of this.data',
            code: `class TodoCarburetor extends Carburetor {
                public setTitle = (title: string) => {
                    this.data.title = title;

                    this.emitUpdate();
                };
            }`,
            errors: [{message: /invalidates the whole store/, line: 3}],
        },
        {
            name: 'assigning deep inside this.data',
            code: `class TodoCarburetor extends Carburetor {
                public toggle = (id: string) => {
                    this.data.items[id].done = true;

                    this.emitUpdate();
                };
            }`,
            errors: 1,
        },
        {
            name: 'an in-place array change on this.data',
            code: `class TodoCarburetor extends Carburetor {
                public addId = (id: string) => {
                    this.data.orderIds.push(id);

                    this.emitUpdate();
                };
            }`,
            errors: 1,
        },
        {
            name: 'deleting from this.data',
            code: `class TodoCarburetor extends Carburetor {
                public remove = (id: string) => {
                    delete this.data.items[id];

                    this.emitUpdate();
                };
            }`,
            errors: 1,
        },
        {
            name: 'a resource subclass counts as a carburetor',
            code: `class TodoResource extends ResourceCarburetor {
                protected preEmit = () => {
                    this.data.updatedAt = Date.now();
                };
            }`,
            errors: 1,
        },
    ],
});
