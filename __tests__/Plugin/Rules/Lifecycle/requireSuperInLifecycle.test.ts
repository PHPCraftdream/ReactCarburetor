import {RuleTester} from "oxlint/plugins-dev";
import {requireSuperInLifecycle} from "@plugin/Rules/Lifecycle/requireSuperInLifecycle.mts";

const rule = requireSuperInLifecycle as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'tsx'}}});

tester.run('require-super-in-lifecycle', rule, {
    valid: [
        {
            name: 'componentDidMount calling super',
            code: `class Row extends AntiHookComponent {
                public componentDidMount(): void {
                    super.componentDidMount();

                    this.load();
                }
            }`,
        },
        {
            name: 'componentWillUnmount calling super last',
            code: `class Row extends AntiHookComponent {
                public componentWillUnmount(): void {
                    this.socket.close();

                    super.componentWillUnmount();
                }
            }`,
        },
        {
            name: 'shouldComponentUpdate combining its answer with the base one',
            code: `class Row extends AntiHookComponent {
                public shouldComponentUpdate(nextProps, nextState): boolean {
                    return super.shouldComponentUpdate(nextProps, nextState) || this.dirty;
                }
            }`,
        },
        {
            name: 'shouldComponentUpdate keeping the base answer in a variable first',
            code: `class Row extends AntiHookComponent {
                public shouldComponentUpdate(nextProps, nextState): boolean {
                    const base = super.shouldComponentUpdate(nextProps, nextState);

                    return base || this.dirty;
                }
            }`,
        },
        {
            name: 'declaring effects instead of touching the lifecycle',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => this.load(), 'load', []);
                }
            }`,
        },
        {
            name: 'a lifecycle method on a class that is not a carburetor component',
            code: `class Widget extends React.Component {
                public componentDidMount(): void {
                    this.load();
                }
            }`,
        },
    ],
    invalid: [
        {
            name: 'componentDidMount without super',
            code: `class Row extends AntiHookComponent {
                public componentDidMount(): void {
                    this.load();
                }
            }`,
            errors: [{message: /without calling super.componentDidMount/, line: 2}],
        },
        {
            name: 'componentDidUpdate without super',
            code: `class Row extends AntiHookComponent {
                public componentDidUpdate(prevProps): void {
                    this.sync(prevProps);
                }
            }`,
            errors: 1,
        },
        {
            name: 'componentWillUnmount without super leaks every subscription',
            code: `class Row extends AntiHookComponent {
                public componentWillUnmount(): void {
                    this.socket.close();
                }
            }`,
            errors: 1,
        },
        {
            name: 'calling a different super method does not count',
            code: `class Row extends AntiHookComponent {
                public componentDidMount(): void {
                    super.componentDidUpdate(this.props);
                }
            }`,
            errors: 1,
        },
        {
            name: 'shouldComponentUpdate that discards the base answer',
            code: `class Row extends AntiHookComponent {
                public shouldComponentUpdate(nextProps, nextState): boolean {
                    super.shouldComponentUpdate(nextProps, nextState);

                    return this.dirty;
                }
            }`,
            errors: [{message: /discards its answer/}],
        },
        {
            name: 'every override is checked, not just the first',
            code: `class Row extends ScopedAntiHookComponent {
                public componentDidMount(): void {
                    this.load();
                }

                public componentWillUnmount(): void {
                    this.stop();
                }
            }`,
            errors: 2,
        },
    ],
});
