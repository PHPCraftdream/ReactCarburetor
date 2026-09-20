import {RuleTester} from "oxlint/plugins-dev";
import {noStoreWriteInRender} from "@plugin/Rules/Writes/noStoreWriteInRender.mts";

const rule = noStoreWriteInRender as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'tsx'}}});

tester.run('no-store-write-in-render', rule, {
    valid: [
        {
            name: 'writing from an effect',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => store.markSeen(), 'seen', []);
                }

                public render() {
                    const data = this.useCarburetor(store);

                    return <span>{data.title}</span>;
                }
            }`,
        },
        {
            name: 'writing from a handler created in render',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const data = this.useCarburetor(store);

                    return <button onClick={() => store.markSeen()}>{data.title}</button>;
                }
            }`,
        },
        {
            name: 'reading in render is what the read methods are for',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const data = this.useCarburetor(store);

                    return <span>{store.getVersion()}{data.title}</span>;
                }
            }`,
        },
        {
            name: 'a call on something the file never identified as a store',
            code: `class Row extends AntiHookComponent {
                public render() {
                    return <span>{formatter.format(this.props.value)}</span>;
                }
            }`,
        },
    ],
    invalid: [
        {
            name: 'writing to a store read by the same component',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const data = this.useCarburetor(store);

                    store.markSeen();

                    return <span>{data.title}</span>;
                }
            }`,
            errors: [{message: /while this component renders/, line: 5}],
        },
        {
            name: 'a store reached through props, identified by the same text',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const data = this.useCarburetor(this.props.carburetor);

                    this.props.carburetor.createTodo();

                    return <span>{data.title}</span>;
                }
            }`,
            errors: 1,
        },
        {
            name: 'a store named in options but never read here',
            code: `class Row extends AntiHookComponent {
                public render() {
                    store.markSeen();

                    return null;
                }
            }`,
            options: [{storeNames: ['store']}],
            errors: 1,
        },
        {
            name: 'writing inside a map callback, which also runs during the render',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const data = this.useCarburetor(store);

                    return data.orderIds.map(id => store.markSeen(id));
                }
            }`,
            errors: 1,
        },
        {
            name: 'a computed is identified the same way',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const count = this.useComputed(visibleCount);

                    visibleCount.invalidate();

                    return <span>{count}</span>;
                }
            }`,
            errors: 1,
        },
    ],
});
