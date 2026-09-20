import {RuleTester} from "oxlint/plugins-dev";
import {requireEmitAfterDraftWrite} from "@plugin/Rules/Writes/requireEmitAfterDraftWrite.mts";

const rule = requireEmitAfterDraftWrite as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'ts'}}});

tester.run('require-emit-after-draft-write', rule, {
    valid: [
        {
            name: 'update mutates and publishes in one step',
            code: `class TodoCarburetor extends Carburetor {
                public setTitle = (title: string) => {
                    this.update(draft => {
                        draft.title = title;
                    });
                };
            }`,
        },
        {
            name: 'a draft write followed by emitUpdate',
            code: `class TodoCarburetor extends Carburetor {
                public setTitle = (title: string) => {
                    this.draft.title = title;

                    this.emitUpdate();
                };
            }`,
        },
        {
            name: 'emitSoon publishes too',
            code: `class TodoCarburetor extends Carburetor {
                public setTitle = (title: string) => {
                    this.draft.title = title;

                    this.emitSoon();
                };
            }`,
        },
        {
            name: 'an array mutation followed by emitUpdate',
            code: `class TodoCarburetor extends Carburetor {
                public addId = (id: string) => {
                    this.draft.orderIds.push(id);

                    this.emitUpdate();
                };
            }`,
        },
        {
            name: 'a write inside this.update stays published even when it goes through this.draft',
            code: `class TodoCarburetor extends Carburetor {
                public setTitle = (title: string) => {
                    this.update(() => {
                        this.draft.title = title;
                    });
                };
            }`,
        },
        {
            name: 'a method that deliberately leaves publishing to its caller',
            code: `class TodoCarburetor extends Carburetor {
                protected applyTitle = (title: string) => {
                    this.draft.title = title;
                };
            }`,
            options: [{deferredEmitMethods: ['applyTitle']}],
        },
        {
            name: 'a draft write in a class that is not a carburetor',
            code: `class Editor {
                public setTitle = (title: string) => {
                    this.draft.title = title;
                };
            }`,
        },
        {
            name: 'reading draft without writing it',
            code: `class TodoCarburetor extends Carburetor {
                public hasTitle = (): boolean => {
                    return Boolean(this.draft.title);
                };
            }`,
        },
    ],
    invalid: [
        {
            name: 'a draft write that never publishes',
            code: `class TodoCarburetor extends Carburetor {
                public setTitle = (title: string) => {
                    this.draft.title = title;
                };
            }`,
            errors: [{message: /never publishes/, line: 3}],
        },
        {
            name: 'an increment that never publishes',
            code: `class TodoCarburetor extends Carburetor {
                public bump = () => {
                    this.draft.version++;
                };
            }`,
            errors: 1,
        },
        {
            name: 'a delete that never publishes',
            code: `class TodoCarburetor extends Carburetor {
                public remove = (id: string) => {
                    delete this.draft.items[id];
                };
            }`,
            errors: 1,
        },
        {
            name: 'an in-place array change that never publishes',
            code: `class TodoCarburetor extends Carburetor {
                public addId = (id: string) => {
                    this.draft.orderIds.push(id);
                };
            }`,
            errors: 1,
        },
        {
            name: 'one report per method, not per write',
            code: `class TodoCarburetor extends Carburetor {
                public setBoth = (title: string, done: boolean) => {
                    this.draft.title = title;
                    this.draft.done = done;
                };
            }`,
            errors: 1,
        },
        {
            name: 'emitting in one method does not cover a write in another',
            code: `class TodoCarburetor extends Carburetor {
                public setTitle = (title: string) => {
                    this.draft.title = title;
                };

                public setDone = (done: boolean) => {
                    this.draft.done = done;

                    this.emitUpdate();
                };
            }`,
            errors: 1,
        },
        {
            name: 'emitting on something other than this does not count',
            code: `class TodoCarburetor extends Carburetor {
                public setTitle = (title: string) => {
                    this.draft.title = title;

                    other.emitUpdate();
                };
            }`,
            errors: 1,
        },
    ],
});
