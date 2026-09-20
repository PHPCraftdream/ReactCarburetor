import {RuleTester} from "oxlint/plugins-dev";
import {noLifecycleClassProperty} from "@plugin/Rules/Lifecycle/noLifecycleClassProperty.mts";

/**
 * The tester comes from oxlint itself (`oxlint/plugins-dev`), so the rule is exercised by the
 * host that will run it, with no extra dependency and no simulated linter.
 *
 * The cast is the seam between our own minimal rule types and oxlint's generated ones: the
 * shapes agree structurally, but oxlint types every visitor by node kind while the plugin
 * types visitors uniformly and narrows inside each rule.
 */
const rule = noLifecycleClassProperty as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'tsx'}}});

tester.run('no-lifecycle-class-property', rule, {
    valid: [
        {
            name: 'lifecycle declared as a method',
            code: `class Row extends AntiHookComponent {
                public componentDidMount(): void {
                    super.componentDidMount();
                }
            }`,
        },
        {
            name: 'a handler as a class property is the recommended form',
            code: `class Row extends AntiHookComponent {
                public onClick = () => undefined;
            }`,
        },
        {
            name: 'a lifecycle name on a class that is not a component',
            code: `class Service {
                public componentDidMount = () => undefined;
            }`,
        },
        {
            name: 'a lifecycle name on a class extending something unrelated',
            code: `class Row extends HTMLElement {
                public render = () => undefined;
            }`,
        },
        {
            name: 'a static property that merely shares the name',
            code: `class Row extends AntiHookComponent {
                public static render = () => undefined;
            }`,
        },
        {
            name: 'a computed key cannot be resolved statically and is left alone',
            code: `class Row extends AntiHookComponent {
                public [name] = () => undefined;
            }`,
        },
    ],
    invalid: [
        {
            name: 'componentDidMount as a class property',
            code: `class Row extends AntiHookComponent {
                public componentDidMount = () => undefined;
            }`,
            errors: [{message: /componentDidMount.*class property/s, line: 2}],
        },
        {
            name: 'render as a class property',
            code: `class Row extends AntiHookComponent {
                public render = () => null;
            }`,
            errors: [{message: /"render" is declared as a class property/}],
        },
        {
            name: 'shouldComponentUpdate on a scoped component',
            code: `class Row extends ScopedAntiHookComponent {
                protected shouldComponentUpdate = () => true;
            }`,
            errors: 1,
        },
        {
            name: 'a base class reached through a namespace',
            code: `class Row extends carburetor.AntiHookComponent {
                public componentWillUnmount = () => undefined;
            }`,
            errors: 1,
        },
        {
            name: 'every lifecycle property is reported, not just the first',
            code: `class Row extends AntiHookComponent {
                public componentDidMount = () => undefined;
                public componentDidUpdate = () => undefined;
                public componentWillUnmount = () => undefined;
            }`,
            errors: 3,
        },
        {
            name: 'a component declared as a class expression',
            code: `const Row = class extends AntiHookComponent {
                public componentDidCatch = () => undefined;
            };`,
            errors: 1,
        },
        {
            name: 'a configured project-local base class',
            code: `class Row extends ProjectComponent {
                public componentDidMount = () => undefined;
            }`,
            options: [{componentBases: ['ProjectComponent']}],
            errors: 1,
        },
    ],
});
