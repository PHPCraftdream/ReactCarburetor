import {RuleTester} from "oxlint/plugins-dev";
import {noAsyncTransaction} from "@plugin/Rules/Boundaries/noAsyncTransaction.mts";

const rule = noAsyncTransaction as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'ts'}}});

tester.run('no-async-transaction', rule, {
    valid: [
        {
            name: 'a synchronous transaction',
            code: `transaction(() => {
                profileCarburetor.setName(name);
                settingsCarburetor.setTheme(theme);
            });`,
        },
        {
            name: 'the asynchronous work done before the transaction',
            code: `const save = async () => {
                const saved = await api.save(data);

                transaction(() => {
                    profileCarburetor.setName(saved.name);
                });
            };`,
        },
        {
            name: 'a synchronous update',
            code: `class TodoCarburetor extends Carburetor {
                public setTitle = (title: string) => {
                    this.update(draft => {
                        draft.title = title;
                    });
                };
            }`,
        },
        {
            name: 'an await inside a function the transaction merely creates',
            code: `transaction(() => {
                queue.push(async () => {
                    await api.flush();
                });
            });`,
        },
        {
            name: 'an async callback given to something that is not a batch',
            code: `void run(async () => {
                await api.save();
            });`,
        },
    ],
    invalid: [
        {
            name: 'an async transaction body',
            code: `void transaction(async () => {
                await api.save();

                profileCarburetor.setName(name);
            });`,
            errors: [{message: /transaction\(\) is open only while its body runs synchronously/}],
        },
        {
            name: 'an await inside a transaction body',
            code: `void transaction(async function () {
                await api.save();
            });`,
            errors: 1,
        },
        {
            name: 'an async update callback',
            code: `class TodoCarburetor extends Carburetor {
                public setTitle = (title: string) => {
                    this.update(async draft => {
                        await api.save(title);

                        draft.title = title;
                    });
                };
            }`,
            errors: [{message: /update\(\) is open only while its body runs synchronously/}],
        },
        {
            name: 'one report per batching call, however many awaits it holds',
            code: `void transaction(async () => {
                await api.save();
                await api.flush();
            });`,
            errors: 1,
        },
    ],
});
