import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, computed, IReadableCarburetor, TReadonly} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';
import {ReadableAdapter} from './ReadableAdapter';

interface IConditionalData {
    choosePrimary: boolean;
    primary: string;
    secondary: string;
}

interface IHookProps {
    source: IReadableCarburetor<IConditionalData>;
}

const selectConditional = (data: TReadonly<IConditionalData>): string =>
    data.choosePrimary ? data.primary : data.secondary;

let hookRenders = 0;

const HookConsumer = ({source}: IHookProps): React.ReactElement => {
    hookRenders++;
    return <output>{useCarburetorValue(source, selectConditional)}</output>;
};

interface IConnectionProps {
    source: IReadableCarburetor<IConditionalData>;
}

class ConnectionConsumer extends AntiHookComponent<IConnectionProps> {
    public static renders = 0;
    private readonly connected = this.connect(() => this.props.source);
    private readonly selected = this.connectSelection(
        () => this.props.source,
        (data) => data.choosePrimary ? data.primary : data.secondary
    );

    public render(): React.ReactElement {
        ConnectionConsumer.renders++;
        const tracked = this.useCarburetor(this.props.source);
        const trackedValue = selectConditional(tracked);
        const connectedValue = selectConditional(this.connected);
        const selectedValue = this.selected();

        return <output>{`${trackedValue}|${connectedValue}|${selectedValue}`}</output>;
    }
}

describe('readable carburetor sources', () => {
    test('the hook follows conditional reads, swaps sources, and releases the old source', () => {
        const first = new ReadableAdapter<IConditionalData>({
            choosePrimary: true, primary: 'first-primary', secondary: 'first-secondary',
        });
        const second = new ReadableAdapter<IConditionalData>({
            choosePrimary: false, primary: 'second-primary', secondary: 'second-secondary',
        });
        hookRenders = 0;

        const {container, rerender, unmount} = render(<HookConsumer source={first}/>);

        expect(container.textContent).toEqual('first-primary');
        expect(first.subscriberCount).toEqual(1);

        act(() => first.replace({
            choosePrimary: false, primary: 'first-primary', secondary: 'first-secondary',
        }, ['choosePrimary']));
        expect(container.textContent).toEqual('first-secondary');

        const afterBranchChange = hookRenders;
        act(() => first.replace({
            choosePrimary: false, primary: 'unselected-change', secondary: 'first-secondary',
        }, ['primary']));
        expect(hookRenders).toEqual(afterBranchChange);

        act(() => first.replace({
            choosePrimary: false, primary: 'unselected-change', secondary: 'selected-change',
        }, ['secondary']));
        expect(container.textContent).toEqual('selected-change');

        rerender(<HookConsumer source={second}/>);
        expect(container.textContent).toEqual('second-secondary');
        expect(first.subscriberCount).toEqual(0);
        expect(second.subscriberCount).toEqual(1);

        const afterSwap = hookRenders;
        act(() => first.replace({
            choosePrimary: false, primary: 'old-source-write', secondary: 'old-source-write',
        }, ['secondary']));
        expect(hookRenders).toEqual(afterSwap);

        act(() => second.replace({
            choosePrimary: false, primary: 'second-primary', secondary: 'second-updated',
        }, ['secondary']));
        expect(container.textContent).toEqual('second-updated');

        unmount();
        expect(second.subscriberCount).toEqual(0);

        const afterUnmount = hookRenders;
        act(() => second.replace({
            choosePrimary: false, primary: 'second-primary', secondary: 'after-unmount',
        }, ['secondary']));
        expect(hookRenders).toEqual(afterUnmount);
    });

    test('class read entrypoints accept readable sources and silence old sources after swaps', () => {
        const first = new ReadableAdapter<IConditionalData>({
            choosePrimary: true, primary: 'class-first-primary', secondary: 'class-first-secondary',
        });
        const second = new ReadableAdapter<IConditionalData>({
            choosePrimary: false, primary: 'class-second-primary', secondary: 'class-second-secondary',
        });
        ConnectionConsumer.renders = 0;

        const {container, rerender, unmount} = render(<ConnectionConsumer source={first}/>);

        expect(container.textContent).toEqual(
            'class-first-primary|class-first-primary|class-first-primary'
        );

        act(() => first.replace({
            choosePrimary: false, primary: 'class-first-primary', secondary: 'class-first-secondary',
        }, ['choosePrimary']));
        expect(container.textContent).toEqual(
            'class-first-secondary|class-first-secondary|class-first-secondary'
        );

        rerender(<ConnectionConsumer source={second}/>);
        expect(container.textContent).toEqual(
            'class-second-secondary|class-second-secondary|class-second-secondary'
        );
        expect(first.subscriberCount).toEqual(0);
        expect(second.subscriberCount).toEqual(3);

        const afterSwap = ConnectionConsumer.renders;
        act(() => first.replace({
            choosePrimary: false, primary: 'old-class-source', secondary: 'old-class-source',
        }, ['secondary']));
        expect(ConnectionConsumer.renders).toEqual(afterSwap);

        act(() => second.replace({
            choosePrimary: false, primary: 'class-second-primary', secondary: 'class-updated',
        }, ['secondary']));
        expect(container.textContent).toEqual('class-updated|class-updated|class-updated');

        unmount();
        expect(second.subscriberCount).toEqual(0);
    });

    test('computed reads re-track conditional paths and refresh from external versions', () => {
        const source = new ReadableAdapter<IConditionalData>({
            choosePrimary: true, primary: 'computed-primary', secondary: 'computed-secondary',
        });
        const result = computed((read) => {
            const data = read(source);
            return data.choosePrimary ? data.primary : data.secondary;
        });
        const changes: string[] = [];
        const id = result.subscribe(() => changes.push(result.get()));

        expect(result.get()).toEqual('computed-primary');
        expect(source.subscriberCount).toEqual(1);

        source.replace({
            choosePrimary: false, primary: 'computed-primary', secondary: 'computed-secondary',
        }, ['choosePrimary']);
        expect(result.get()).toEqual('computed-secondary');
        expect(changes).toEqual(['computed-secondary']);

        source.replace({
            choosePrimary: false, primary: 'unselected-computed-write', secondary: 'computed-secondary',
        }, ['primary']);
        expect(changes).toEqual(['computed-secondary']);
        expect(result.get()).toEqual('computed-secondary');

        result.unsubscribe(id);
        expect(source.subscriberCount).toEqual(0);

        const freshnessSource = new ReadableAdapter({count: 1});
        const fresh = computed((read) => read(freshnessSource).count);
        expect(fresh.get()).toEqual(1);
        freshnessSource.replace({count: 2}, ['count'], false);
        expect(fresh.get()).toEqual(2);
    });
});
