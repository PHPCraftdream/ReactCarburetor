import {RuleTester} from "oxlint/plugins-dev";
import {noUseCarburetorOutsideRender} from "@plugin/Rules/Reads/noUseCarburetorOutsideRender.mts";

const rule = noUseCarburetorOutsideRender as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'tsx'}}});

tester.run('no-use-carburetor-outside-render', rule, {
    valid: [
        {
            name: 'reading in render',
            code: `class Row extends AntiHookComponent {
                public render() {
                    const {title} = this.useCarburetor(store);

                    return <span>{title}</span>;
                }
            }`,
        },
        {
            // There is no slot array here: a read registers a path and the commit subscribes to
            // whatever the render actually read. Conditional reads are supported by design.
            name: 'a conditional read in render is supported, not a hazard',
            code: `class Row extends AntiHookComponent {
                public render() {
                    if (this.props.expanded) {
                        const {title} = this.useCarburetor(store);

                        return <span>{title}</span>;
                    }

                    return null;
                }
            }`,
        },
        {
            name: 'a read in a loop in render is supported too',
            code: `class Row extends AntiHookComponent {
                public render() {
                    return this.props.ids.map(id => this.useCarburetor(store).items[id].title);
                }
            }`,
        },
        {
            name: 'useComputed in render',
            code: `class Row extends AntiHookComponent {
                public render() {
                    return <span>{this.useComputed(visibleCount)}</span>;
                }
            }`,
        },
        {
            name: 'getData in a handler is the supported way to read outside render',
            code: `class Row extends AntiHookComponent {
                @bind
                protected onClick(): void {
                    log(store.getData().title);
                }
            }`,
        },
        {
            name: 'a method of the same name on a class that is not a component',
            code: `class Widget {
                public load(): void {
                    this.useCarburetor(store);
                }
            }`,
        },
    ],
    invalid: [
        {
            name: 'reading in an event handler',
            code: `class Row extends AntiHookComponent {
                @bind
                protected onClick(): void {
                    const data = this.useCarburetor(store);

                    log(data.title);
                }
            }`,
            errors: [{message: /does not establish a subscription/, line: 4}],
        },
        {
            name: 'reading in an effect',
            code: `class Row extends AntiHookComponent {
                protected useEffects(): void {
                    this.useEffect(() => log(this.useCarburetor(store)), 'log', []);
                }
            }`,
            errors: 1,
        },
        {
            name: 'reading in the constructor',
            code: `class Row extends AntiHookComponent {
                constructor(props) {
                    super(props);

                    this.data = this.useCarburetor(store);
                }
            }`,
            errors: 1,
        },
        {
            name: 'reading a computed in a lifecycle method',
            code: `class Row extends AntiHookComponent {
                public componentDidMount(): void {
                    super.componentDidMount();

                    log(this.useComputed(visibleCount));
                }
            }`,
            errors: 1,
        },
    ],
});
