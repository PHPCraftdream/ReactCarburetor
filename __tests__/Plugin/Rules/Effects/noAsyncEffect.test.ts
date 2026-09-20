import {RuleTester} from "oxlint/plugins-dev";
import {noAsyncEffect} from "@plugin/Rules/Effects/noAsyncEffect.mts";

const rule = noAsyncEffect as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'ts'}}});

tester.run('no-async-effect', rule, {
    valid: [
        {
            name: 'a synchronous body returning a cleanup',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => {
                        const controller = new AbortController();

                        void resource.load(controller.signal);

                        return () => controller.abort();
                    }, 'load', []);
                }
            }`,
        },
        {
            name: 'a synchronous body with no cleanup at all',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => log('mounted'), 'log', []);
                }
            }`,
        },
        {
            name: 'a promise deliberately left floating, with the cleanup that matters returned',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => {
                        void loadEverything();

                        return () => stop();
                    }, 'load', []);
                }
            }

            async function loadEverything() {}`,
        },
        {
            name: 'an async function passed somewhere that is not an effect',
            code: `void queue.push(async () => load());`,
        },
    ],
    invalid: [
        {
            name: 'an async arrow body',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(async () => {
                        await resource.load();
                    }, 'load', []);
                }
            }`,
            errors: [{message: /never clean up after itself/, line: 3}],
        },
        {
            name: 'an async function expression body',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(async function () {
                        await resource.load();
                    }, 'load', []);
                }
            }`,
            errors: 1,
        },
        {
            name: 'a body that only returns the promise of a local async function',
            code: `async function loadEverything() {}

            class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => loadEverything(), 'load', []);
                }
            }`,
            errors: 1,
        },
        {
            name: 'a body that returns the promise of a local async arrow',
            code: `const loadEverything = async () => undefined;

            class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => {
                        return loadEverything();
                    }, 'load', []);
                }
            }`,
            errors: 1,
        },
    ],
});
