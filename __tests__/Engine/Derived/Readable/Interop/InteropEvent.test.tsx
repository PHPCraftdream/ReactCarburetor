import {act} from 'react';
import {render} from '@testing-library/react';
import {Carburetor} from '@/Carburetor';
import {useCarburetorEvent} from '@/Interop';

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

describe('useCarburetorEvent', () => {
    test('subscribes and releases on mount and unmount', () => {
        const store = new EventStore({value: 0});
        const values: number[] = [];
        const handler = (value: number): void => { values.push(value); };
        const View = () => { useCarburetorEvent(store, 'ping', handler); return null; };
        const view = render(<View/>);
        expect(store.registrations).toBe(1);
        act(() => store.ping(1));
        expect(values).toEqual([1]);
        view.unmount();
        expect(store.disposals).toBe(1);
    });

    test('replaces registration for store, name, and handler changes', () => {
        const first = new EventStore({value: 0});
        const second = new EventStore({value: 0});
        const values: string[] = [];
        const firstHandler = (value: number): void => { values.push(`first:${value}`); };
        const nextHandler = (value: number): void => { values.push(`next:${value}`); };
        const View = ({store, name, handler}: {
            store: EventStore; name: 'ping' | 'pong'; handler: (value: number) => void;
        }) => { useCarburetorEvent(store, name, handler); return null; };
        const view = render(<View store={first} name="ping" handler={firstHandler}/>);
        view.rerender(<View store={second} name="ping" handler={firstHandler}/>);
        view.rerender(<View store={second} name="pong" handler={firstHandler}/>);
        view.rerender(<View store={second} name="pong" handler={nextHandler}/>);
        act(() => { first.ping(1); second.ping(2); second.pong(3); });
        expect(values).toEqual(['next:3']);
        expect(first.disposals).toBe(1);
        expect(second.registrations).toBe(3);
        view.unmount();
        expect(second.disposals).toBe(3);
    });
});
