import {RuleTester} from "oxlint/plugins-dev";
import {noComputedGetInRender} from "@plugin/Rules/Reads/noComputedGetInRender.mts";

const rule = noComputedGetInRender as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'tsx'}}});

tester.run('no-computed-get-in-render', rule, {
    valid: [
        {
            name: 'reading a computed in render through useComputed',
            code: `class Row extends AntiHookComponent {
                public render() {
                    return <span>{this.useComputed(visibleCount)}</span>;
                }
            }`,
        },
        {
            name: 'a keyed get in render belongs to something else',
            code: `class Row extends AntiHookComponent {
                public render() {
                    return <span>{titles.get(this.props.id)}</span>;
                }
            }`,
        },
        {
            name: 'get in an event handler is the correct call',
            code: `class Row extends AntiHookComponent {
                @bind
                protected onClick(): void {
                    log(visibleCount.get());
                }
            }`,
        },
        {
            name: 'get inside a handler created in render runs after the commit',
            code: `class Row extends AntiHookComponent {
                public render() {
                    return <button onClick={() => log(visibleCount.get())}>log</button>;
                }
            }`,
        },
        {
            name: 'get in a class that is not a carburetor component',
            code: `class Widget {
                public render() {
                    return visibleCount.get();
                }
            }`,
        },
    ],
    invalid: [
        {
            name: 'computed read with get in render',
            code: `class Row extends AntiHookComponent {
                public render() {
                    return <span>{visibleCount.get()}</span>;
                }
            }`,
            errors: [{message: /useComputed/, line: 3}],
        },
        {
            name: 'computed read with get in a render helper listed in options',
            code: `class Row extends AntiHookComponent {
                public renderCount() {
                    return <span>{visibleCount.get()}</span>;
                }
            }`,
            options: [{renderMethods: ['renderCount']}],
            errors: 1,
        },
        {
            name: 'a computed reached through a member chain',
            code: `class Row extends AntiHookComponent {
                public render() {
                    return <span>{this.props.totals.get()}</span>;
                }
            }`,
            errors: 1,
        },
    ],
});
