import {RuleTester} from "oxlint/plugins-dev";
import {requireEffectDeps} from "@plugin/Rules/Effects/requireEffectDeps.mts";

const rule = requireEffectDeps as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'ts'}}});

tester.run('require-effect-deps', rule, {
    valid: [
        {
            name: 'the prop it reads is listed',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => connect(this.props.url), 'connect', [this.props.url]);
                }
            }`,
        },
        {
            name: 'a dependency covers the reads below it',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => greet(this.props.user.name), 'greet', [this.props.user]);
                }
            }`,
        },
        {
            name: 'state is listed too',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => resize(this.state.width), 'resize', [this.state.width]);
                }
            }`,
        },
        {
            // An empty array with no reads is the deliberate run-once effect.
            name: 'an effect that reads nothing per-render runs once on purpose',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => connect(store.getData().url), 'connect', []);
                }
            }`,
        },
        {
            name: 'a store is subscribed to, not depended on',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => log(todoCarburetor.getData().title), 'log', []);
                }
            }`,
        },
        {
            // Passing a stable bound method is recommended here; what it reads is not visible.
            name: 'a body that is a reference rather than an inline function',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(this.props.carburetor.loadData, 'load', []);
                }
            }`,
        },
        {
            name: 'props read outside any effect',
            code: `class Row extends AntiHookComponent {
                public render() {
                    return this.props.url;
                }
            }`,
        },
        {
            name: 'several dependencies, all listed',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(
                        () => connect(this.props.url, this.state.token),
                        'connect',
                        [this.props.url, this.state.token]
                    );
                }
            }`,
        },
    ],
    invalid: [
        {
            name: 'a prop read with an empty dependency array',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => connect(this.props.url), 'connect', []);
                }
            }`,
            errors: [{message: /this.props.url is read by this effect/, line: 3}],
        },
        {
            name: 'one of two dependencies missing',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(
                        () => connect(this.props.url, this.state.token),
                        'connect',
                        [this.props.url]
                    );
                }
            }`,
            errors: 1,
        },
        {
            name: 'a read from inside the cleanup counts as well',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => {
                        const socket = connect();

                        return () => socket.close(this.props.reason);
                    }, 'connect', []);
                }
            }`,
            errors: 1,
        },
        {
            name: 'a deeper read is not covered by a sibling dependency',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => greet(this.props.user.name), 'greet', [this.props.id]);
                }
            }`,
            errors: 1,
        },
    ],
});
