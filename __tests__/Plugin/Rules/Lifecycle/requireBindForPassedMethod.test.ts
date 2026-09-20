import {RuleTester} from "oxlint/plugins-dev";
import {requireBindForPassedMethod} from "@plugin/Rules/Lifecycle/requireBindForPassedMethod.mts";

const rule = requireBindForPassedMethod as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'tsx'}}});

tester.run('require-bind-for-passed-method', rule, {
    valid: [
        {
            name: 'a decorated method passed as a value',
            code: `class Row extends AntiHookComponent {
                @bind
                protected onClick(): void {
                    store.toggle(this.props.id);
                }

                public render() {
                    return <button onClick={this.onClick}>toggle</button>;
                }
            }`,
        },
        {
            name: 'an arrow class property is already bound',
            code: `class Row extends AntiHookComponent {
                protected onClick = (): void => {
                    store.toggle(this.props.id);
                };

                public render() {
                    return <button onClick={this.onClick}>toggle</button>;
                }
            }`,
        },
        {
            name: 'a method that never touches this keeps working detached',
            code: `class Row extends AntiHookComponent {
                protected format(value: number): string {
                    return String(value);
                }

                public render() {
                    return <List format={this.format}/>;
                }
            }`,
        },
        {
            name: 'calling the method keeps its receiver',
            code: `class Row extends AntiHookComponent {
                protected onClick(): void {
                    store.toggle(this.props.id);
                }

                public render() {
                    return <button onClick={() => this.onClick()}>toggle</button>;
                }
            }`,
        },
        {
            name: 'reading a field is not passing a method',
            code: `class Row extends AntiHookComponent {
                public render() {
                    return <span>{this.props.title}</span>;
                }
            }`,
        },
        {
            name: 'a method of a class that is not a carburetor component',
            code: `class Widget extends React.Component {
                protected onClick(): void {
                    this.load();
                }

                public render() {
                    return <button onClick={this.onClick}>go</button>;
                }
            }`,
        },
    ],
    invalid: [
        {
            name: 'an undecorated method passed to a DOM handler',
            code: `class Row extends AntiHookComponent {
                protected onClick(): void {
                    store.toggle(this.props.id);
                }

                public render() {
                    return <button onClick={this.onClick}>toggle</button>;
                }
            }`,
            errors: [{message: /passed as a value/, line: 7}],
        },
        {
            name: 'an undecorated method passed to a child component',
            code: `class Row extends AntiHookComponent {
                protected onToggle(): void {
                    this.props.carburetor.toggle(this.props.id);
                }

                public render() {
                    return <TodoRow onToggle={this.onToggle}/>;
                }
            }`,
            errors: 1,
        },
        {
            name: 'an undecorated method handed to a subscription',
            code: `class Row extends AntiHookComponent {
                protected onUpdate(): void {
                    this.forceUpdate();
                }

                protected useEffects(): void {
                    this.useEffect(() => store.watch(reads, this.onUpdate), 'watch', []);
                }
            }`,
            errors: 1,
        },
        {
            name: 'a method declared after the reference is still found',
            code: `class Row extends AntiHookComponent {
                public render() {
                    return <button onClick={this.onClick}>toggle</button>;
                }

                protected onClick(): void {
                    store.toggle(this.props.id);
                }
            }`,
            errors: 1,
        },
        {
            name: 'a decorator that is not bind does not bind anything',
            code: `class Row extends AntiHookComponent {
                @logged
                protected onClick(): void {
                    store.toggle(this.props.id);
                }

                public render() {
                    return <button onClick={this.onClick}>toggle</button>;
                }
            }`,
            errors: 1,
        },
    ],
});
