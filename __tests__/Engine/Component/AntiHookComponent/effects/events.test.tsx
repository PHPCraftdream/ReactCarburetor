import {act, StrictMode} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor, bind} from '@/Carburetor';

interface IData {value: number}
interface IEvents {ping: number; pong: number}

class EventStore extends Carburetor<IData, IEvents> {
    public registrations = 0;
    public disposals = 0;

    public override on<K extends keyof IEvents>(name: K, listener: (payload: IEvents[K]) => void) {
        this.registrations++;
        const dispose = super.on(name, listener);
        return () => { this.disposals++; dispose(); };
    }

    public ping(value: number): void { this.emit('ping', value); }
    public pong(value: number): void { this.emit('pong', value); }
}

describe('component event subscriptions', () => {
    test('subscribes once across commits and releases on unmount', () => {
        const store = new EventStore({value: 0});
        const values: number[] = [];
        class View extends AntiHookComponent<{label: string}> {
            @bind protected receive(value: number): void { values.push(value); }
            protected useEffects(): void { this.useEvent(store, 'ping', this.receive); }
            render() { return <span>{this.props.label}</span>; }
        }
        const view = render(<View label="a"/>);
        view.rerender(<View label="b"/>);
        expect(store.registrations).toBe(1);
        act(() => store.ping(1));
        expect(values).toEqual([1]);
        view.unmount();
        expect(store.disposals).toBe(1);
        act(() => store.ping(2));
        expect(values).toEqual([1]);
    });

    test('replaces the registration when its store changes', () => {
        const first = new EventStore({value: 0});
        const second = new EventStore({value: 0});
        const values: number[] = [];
        class View extends AntiHookComponent<{store: EventStore}> {
            @bind protected receive(value: number): void { values.push(value); }
            protected useEffects(): void { this.useEvent(this.props.store, 'ping', this.receive); }
            render() { return <span/>; }
        }
        const view = render(<View store={first}/>);
        view.rerender(<View store={second}/>);
        act(() => { first.ping(1); second.ping(2); });
        expect(values).toEqual([2]);
        expect(first.disposals).toBe(1);
        view.unmount();
    });

    test('StrictMode leaves one active event listener', () => {
        const store = new EventStore({value: 0});
        const values: number[] = [];
        class View extends AntiHookComponent {
            @bind protected receive(value: number): void { values.push(value); }
            protected useEffects(): void { this.useEvent(store, 'ping', this.receive); }
            render() { return <span/>; }
        }
        const view = render(<StrictMode><View/></StrictMode>);
        act(() => store.ping(3));
        expect(values).toEqual([3]);
        view.unmount();
        expect(store.registrations).toBe(store.disposals);
    });
});
