import {RuleTester} from "oxlint/plugins-dev";
import {noDuplicateEffectName} from "@plugin/Rules/Effects/noDuplicateEffectName.mts";

const rule = noDuplicateEffectName as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'ts'}}});

tester.run('no-duplicate-effect-name', rule, {
    valid: [
        {
            name: 'distinct names',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(connect, 'connect', [this.props.url]);
                    this.useEffect(startTimer, 'timer', [this.props.interval]);
                }
            }`,
        },
        {
            name: 'the same name in two different components',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(connect, 'effect', []);
                }
            }

            class Other extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(startTimer, 'effect', []);
                }
            }`,
        },
        {
            name: 'a name built at runtime cannot be compared',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(connect, \`row-\${this.props.id}\`, []);
                    this.useEffect(startTimer, \`row-\${this.props.id}\`, []);
                }
            }`,
        },
        {
            name: 'the same name registered outside a component class',
            code: `helper.useEffect(connect, 'effect', []);
            helper.useEffect(startTimer, 'effect', []);`,
        },
    ],
    invalid: [
        {
            name: 'two effects sharing a name',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(connect, 'effect', [this.props.url]);
                    this.useEffect(startTimer, 'effect', [this.props.interval]);
                }
            }`,
            errors: [{message: /overwrites the first/, line: 4}],
        },
        {
            name: 'a name reused from another method of the same component',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(connect, 'effect', []);
                    this.registerMore();
                }

                protected registerMore(): void {
                    this.useEffect(startTimer, 'effect', []);
                }
            }`,
            errors: 1,
        },
        {
            name: 'three effects under one name report twice',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(a, 'effect', []);
                    this.useEffect(b, 'effect', []);
                    this.useEffect(c, 'effect', []);
                }
            }`,
            errors: 2,
        },
    ],
});
