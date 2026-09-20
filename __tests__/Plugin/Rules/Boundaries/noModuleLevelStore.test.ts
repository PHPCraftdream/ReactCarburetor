import {RuleTester} from "oxlint/plugins-dev";
import {noModuleLevelStore} from "@plugin/Rules/Boundaries/noModuleLevelStore.mts";

const rule = noModuleLevelStore as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'ts'}}});

tester.run('no-module-level-store', rule, {
    valid: [
        {
            name: 'a store created through a scope token',
            code: `export const todoToken = carburetorToken(() => new TodoCarburetor(api));`,
        },
        {
            name: 'a store created inside a factory',
            code: `export const createStore = () => new TodoCarburetor(api);`,
        },
        {
            name: 'a store created in a class field',
            code: `class Container {
                protected store = new TodoCarburetor(api);
            }`,
        },
        {
            name: 'something at module level that is not a store',
            code: `export const formatter = new Intl.NumberFormat('en');`,
        },
        {
            name: 'a module-level Map is not a store either',
            code: `export const cache = new Map<string, number>();`,
        },
    ],
    invalid: [
        {
            name: 'a module-level store named by convention',
            code: `export const todoCarburetor = new TodoCarburetor(api);`,
            errors: [{message: /every request shares this instance/}],
        },
        {
            name: 'a module-level instance of a store class declared in the same file',
            code: `class Profile extends Carburetor {
            }

            export const profile = new Profile({});`,
            errors: 1,
        },
        {
            name: 'a resource subclass declared in the same file',
            code: `class Todos extends ResourceCarburetor {
            }

            export const todos = new Todos(load);`,
            errors: 1,
        },
        {
            name: 'a store constructor named in options',
            code: `export const store = new AppState({});`,
            options: [{storeConstructors: ['AppState']}],
            errors: 1,
        },
        {
            name: 'a store held in a module-level object',
            code: `export const stores = {todo: new TodoCarburetor(api)};`,
            errors: 1,
        },
    ],
});
