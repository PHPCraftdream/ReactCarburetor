import {RuleTester} from "oxlint/plugins-dev";
import {noTrackedDataMutation} from "@plugin/Rules/Writes/noTrackedDataMutation.mts";

const rule = noTrackedDataMutation as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'tsx'}}});

tester.run('no-tracked-data-mutation', rule, {
    valid: [
        {
            name: 'reading tracked data and writing through a store method',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const data = this.useCarburetor(store);

                    return <button onClick={() => store.toggle(this.props.id)}>{data.title}</button>;
                }
            }`,
        },
        {
            name: 'mutating a local of the same name in another method',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const data = this.useCarburetor(store);

                    return <span>{data.title}</span>;
                }

                @bind
                protected onClick(): void {
                    const data = {title: ''};

                    data.title = 'x';
                }
            }`,
        },
        {
            name: 'mutating something read with getData is another rule\'s business',
            code: `class Row extends AntiHookComponent {
                @bind
                protected onClick(): void {
                    const data = store.getData();

                    data.title = 'x';
                }
            }`,
        },
    ],
    invalid: [
        {
            name: 'assigning through tracked data',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const data = this.useCarburetor(store);

                    data.title = 'x';

                    return null;
                }
            }`,
            errors: [{message: /read-only/, line: 5}],
        },
        {
            name: 'assigning deep inside tracked data',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const data = this.useCarburetor(store);

                    data.items[this.props.id].done = true;

                    return null;
                }
            }`,
            errors: 1,
        },
        {
            name: 'an in-place array change on tracked data',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const data = this.useCarburetor(store);

                    data.orderIds.push('a');

                    return null;
                }
            }`,
            errors: 1,
        },
        {
            name: 'a destructured branch is still tracked data',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const {items} = this.useCarburetor(store);

                    items[this.props.id].done = true;

                    return null;
                }
            }`,
            errors: 1,
        },
        {
            name: 'a write hidden behind a cast is exactly what the rule is for',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const data = this.useCarburetor(store);

                    delete data.items['a'];

                    return null;
                }
            }`,
            errors: 1,
        },
    ],
});
