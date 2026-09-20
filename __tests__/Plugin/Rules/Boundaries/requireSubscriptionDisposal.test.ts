import {RuleTester} from "oxlint/plugins-dev";
import {requireSubscriptionDisposal} from "@plugin/Rules/Boundaries/requireSubscriptionDisposal.mts";

const rule = requireSubscriptionDisposal as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'ts'}}});

tester.run('require-subscription-disposal', rule, {
    valid: [
        {
            name: 'watch returns a disposer',
            code: `const dispose = todoCarburetor.watch(reads, () => log(todoCarburetor.getData()));`,
        },
        {
            name: 'the subscription id is kept',
            code: `const id = todoCarburetor.subscribe(() => log('changed'));`,
        },
        {
            name: 'an explicit id is a handle to release it by',
            code: `todoCarburetor.subscribe(this.onUpdate, {id: this.uid, reads});`,
        },
        {
            name: 'the id is stored on the instance',
            code: `this.subscriptionId = todoCarburetor.subscribe(() => log('changed'));`,
        },
        {
            name: 'a subscribe that belongs to something else entirely',
            code: `const dispose = eventBus.subscribe('tick');`,
        },
    ],
    invalid: [
        {
            name: 'the id is discarded',
            code: `todoCarburetor.subscribe(() => log(todoCarburetor.getData()));`,
            errors: [{message: /can never be released/}],
        },
        {
            name: 'discarded with options that carry no id',
            code: `todoCarburetor.subscribe(() => log('changed'), {reads});`,
            errors: 1,
        },
        {
            name: 'discarded inside an effect, where a cleanup was the whole point',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => {
                        todoCarburetor.subscribe(() => log('changed'));
                    }, 'log', []);
                }
            }`,
            errors: 1,
        },
    ],
});
