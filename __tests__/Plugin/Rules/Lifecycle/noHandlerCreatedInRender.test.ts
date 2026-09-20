import {RuleTester} from "oxlint/plugins-dev";
import {noHandlerCreatedInRender} from "@plugin/Rules/Lifecycle/noHandlerCreatedInRender.mts";

const rule = noHandlerCreatedInRender as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'tsx'}}});

tester.run('no-handler-created-in-render', rule, {
    valid: [
        {
            name: 'a bound method passed by reference',
            code: `class Parent extends AntiHookComponent {
                @bind
                protected onToggle(): void {
                    store.toggle(this.props.id);
                }

                public render() {
                    return <TodoRow onToggle={this.onToggle}/>;
                }
            }`,
        },
        {
            name: 'an arrow on a DOM element costs an attribute update, not a subtree render',
            code: `class Parent extends AntiHookComponent {
                public render() {
                    return <button onClick={() => store.toggle()}>toggle</button>;
                }
            }`,
        },
        {
            name: 'a plain value prop',
            code: `class Parent extends AntiHookComponent {
                public render() {
                    return <TodoRow id={this.props.id}/>;
                }
            }`,
        },
        {
            name: 'a store method, which is already a stable reference',
            code: `class Parent extends AntiHookComponent {
                public render() {
                    return <TodoRow onCreate={store.createTodo}/>;
                }
            }`,
        },
        {
            name: 'an arrow passed to a component listed in options',
            code: `class Parent extends AntiHookComponent {
                public render() {
                    return <Suspense fallback={() => null}/>;
                }
            }`,
            options: [{ignoreComponents: ['Suspense']}],
        },
        {
            name: 'an arrow prop outside a carburetor component',
            code: `class Widget extends React.Component {
                public render() {
                    return <TodoRow onToggle={() => undefined}/>;
                }
            }`,
        },
    ],
    invalid: [
        {
            name: 'an inline arrow passed to a component',
            code: `class Parent extends AntiHookComponent {
                public render() {
                    return <TodoRow onToggle={() => store.toggle(this.props.id)}/>;
                }
            }`,
            errors: [{message: /new function on every render/, line: 3}],
        },
        {
            name: 'a method bound in render',
            code: `class Parent extends AntiHookComponent {
                public render() {
                    return <TodoRow onToggle={this.onToggle.bind(this)}/>;
                }
            }`,
            errors: 1,
        },
        {
            name: 'a function expression prop',
            code: `class Parent extends AntiHookComponent {
                public render() {
                    return <TodoRow onToggle={function () { store.toggle(); }}/>;
                }
            }`,
            errors: 1,
        },
        {
            name: 'inside a map callback, which is still this render',
            code: `class Parent extends AntiHookComponent {
                public render() {
                    return this.props.ids.map(id => <TodoRow key={id} onToggle={() => store.toggle(id)}/>);
                }
            }`,
            errors: 1,
        },
        {
            name: 'every fresh handler is reported',
            code: `class Parent extends AntiHookComponent {
                public render() {
                    return <TodoRow onToggle={() => undefined} onDelete={() => undefined}/>;
                }
            }`,
            errors: 2,
        },
    ],
});
