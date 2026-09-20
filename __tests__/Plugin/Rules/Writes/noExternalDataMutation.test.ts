import {RuleTester} from "oxlint/plugins-dev";
import {noExternalDataMutation} from "@plugin/Rules/Writes/noExternalDataMutation.mts";

const rule = noExternalDataMutation as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'ts'}}});

tester.run('no-external-data-mutation', rule, {
    valid: [
        {
            name: 'reading getData without mutating it',
            code: `const title = todoCarburetor.getData().items[id].title;`,
        },
        {
            name: 'passing a copy of what getData returned',
            code: `save({...todoCarburetor.getData().items[id], done: true});`,
        },
        {
            name: 'changing state through a store method',
            code: `todoCarburetor.updateTodo({...todo, done: true});`,
        },
        {
            name: 'mutating something that is not store data',
            code: `form.getValues().title = 'x';`,
        },
    ],
    invalid: [
        {
            name: 'assigning through getData',
            code: `todoCarburetor.getData().items[id].done = true;`,
            errors: [{message: /without notifying anyone/}],
        },
        {
            name: 'incrementing through getData',
            code: `todoCarburetor.getData().version++;`,
            errors: 1,
        },
        {
            name: 'deleting through getData',
            code: `delete todoCarburetor.getData().items[id];`,
            errors: 1,
        },
        {
            name: 'an in-place array change through getData',
            code: `todoCarburetor.getData().orderIds.push(id);`,
            errors: 1,
        },
        {
            name: 'writing through a cache entry, which every reader of that key shares',
            code: `userCache.getEntry(id).data.name = 'x';`,
            errors: [{message: /getEntry\(\) returned/}],
        },
        {
            name: 'inside the store itself, where draft is available',
            code: `class TodoCarburetor extends Carburetor {
                public setTitle = (title: string) => {
                    this.getData().title = title;

                    this.emitUpdate();
                };
            }`,
            errors: 1,
        },
    ],
});
