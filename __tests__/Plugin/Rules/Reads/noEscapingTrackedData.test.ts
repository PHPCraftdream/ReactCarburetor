import {RuleTester} from "oxlint/plugins-dev";
import {noEscapingTrackedData} from "@plugin/Rules/Reads/noEscapingTrackedData.mts";

const rule = noEscapingTrackedData as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'tsx'}}});

tester.run('no-escaping-tracked-data', rule, {
    valid: [
        {
            name: 'tracked data used in the render that read it',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const data = this.useCarburetor(store);

                    return <span>{data.items[this.props.id].title}</span>;
                }
            }`,
        },
        {
            name: 'destructuring leaves nothing tracked to escape',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const {title} = this.useCarburetor(store);

                    return <button onClick={() => log(title)}>{title}</button>;
                }
            }`,
        },
        {
            name: 'a handler reading through getData instead of closing over the proxy',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const data = this.useCarburetor(store);

                    return <button onClick={() => log(store.getData().title)}>{data.title}</button>;
                }
            }`,
        },
        {
            name: 'an unrelated local of the same shape',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const data = buildViewModel(this.props);

                    this.lastData = data;

                    return null;
                }
            }`,
        },
    ],
    invalid: [
        {
            name: 'stored on the component',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const data = this.useCarburetor(store);

                    this.lastData = data;

                    return <span>{data.title}</span>;
                }
            }`,
            errors: [{message: /outlives the render/, line: 5}],
        },
        {
            name: 'captured by a handler created in render',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const data = this.useCarburetor(store);

                    return <button onClick={() => log(data.items)}>log</button>;
                }
            }`,
            errors: [{message: /runs after this render/}],
        },
        {
            name: 'captured by an effect callback',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const data = this.useCarburetor(store);

                    this.useEffect(() => log(data.title), 'log', [data.title]);

                    return null;
                }
            }`,
            errors: 1,
        },
    ],
});
