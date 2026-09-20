import {RuleTester} from "oxlint/plugins-dev";
import {noGetDataInRender} from "@plugin/Rules/Reads/noGetDataInRender.mts";

const rule = noGetDataInRender as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'tsx'}}});

tester.run('no-get-data-in-render', rule, {
    valid: [
        {
            name: 'reading in render through useCarburetor',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const {title} = this.useCarburetor(store);

                    return <span>{title}</span>;
                }
            }`,
        },
        {
            name: 'getData in an event handler is the correct call',
            code: `class Row extends AntiHookComponent {
                @bind
                protected onClick(): void {
                    const todo = store.getData().items[this.props.id];

                    store.updateTodo(todo);
                }
            }`,
        },
        {
            name: 'getData in an effect is the correct call',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => log(store.getData()), 'log', []);
                }
            }`,
        },
        {
            name: 'getData inside a handler created in render runs after the commit',
            code: `class Row extends AntiHookComponent {
                public render() {
                    return <button onClick={() => store.getData().reset()}>reset</button>;
                }
            }`,
        },
        {
            name: 'a render method on a class that is not a carburetor component',
            code: `class Widget {
                public render() {
                    return store.getData().title;
                }
            }`,
        },
        {
            name: 'getData outside any class',
            code: `export const dump = () => store.getData();`,
        },
    ],
    invalid: [
        {
            name: 'getData in render',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const {title} = store.getData();

                    return <span>{title}</span>;
                }
            }`,
            errors: [{message: /never re-render/, line: 3}],
        },
        {
            name: 'getData in render reached through props',
            code: `class Row extends AntiHookComponent {
                public render() {
                    return <span>{this.props.carburetor.getData().title}</span>;
                }
            }`,
            errors: 1,
        },
        {
            name: 'getData in a render helper listed in options',
            code: `class Row extends AntiHookComponent {
                public renderTitle() {
                    return <span>{store.getData().title}</span>;
                }

                public render() {
                    return this.renderTitle();
                }
            }`,
            options: [{renderMethods: ['render', 'renderTitle']}],
            errors: 1,
        },
        {
            name: 'render declared as a class property still counts as render',
            code: `class Row extends AntiHookComponent {
                public render = () => <span>{store.getData().title}</span>;
            }`,
            errors: 1,
        },
        {
            name: 'getData in render of a configured project base class',
            code: `class Row extends ProjectComponent {
                public render() {
                    return <span>{store.getData().title}</span>;
                }
            }`,
            options: [{componentBases: ['ProjectComponent']}],
            errors: 1,
        },
    ],
});
