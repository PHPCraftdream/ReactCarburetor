import {
    Carburetor, EDevToolsAction, EDevToolsMessageType, IDevToolsConnection,
    IDevToolsMessage, connectDevTools
} from '@/Carburetor';

const own = (value: object, name: string): boolean => Object.prototype.hasOwnProperty.call(value, name);

const createExtension = () => {
    const sent: Array<{action: string; state: unknown}> = [];
    let initial: unknown;
    let listener: ((message: IDevToolsMessage) => void) | undefined;
    const connection: IDevToolsConnection = {
        init: (state: unknown) => { initial = state; },
        send: (action: string, state: unknown) => { sent.push({action, state}); },
        subscribe: (callback: (message: IDevToolsMessage) => void) => {
            listener = callback;
            return () => { listener = undefined; };
        }
    };

    return {
        extension: {connect: () => connection},
        sent,
        get initial() { return initial; },
        emit: (message: IDevToolsMessage) => listener?.(message)
    };
};

test('prototype-named stores publish own keys at init and every update', () => {
    const proto = new Carburetor({value: 0});
    const constructor = new Carburetor({value: 10});
    const ordinary = new Carburetor({value: 20});
    const fake = createExtension();
    const stores = Object.fromEntries([['__proto__', proto], ['constructor', constructor], ['ordinary', ordinary]]);
    const dispose = connectDevTools(stores, {extension: fake.extension});

    const assertState = (state: unknown, expected: number[]) => {
        const payload = state as Record<string, {value: number}>;
        expect(Object.getPrototypeOf(payload)).toBeNull();
        expect(Object.keys(payload)).toEqual(['__proto__', 'constructor', 'ordinary']);
        expect(own(payload, '__proto__')).toBe(true);
        expect(own(payload, 'constructor')).toBe(true);
        expect([payload.__proto__.value, payload.constructor.value, payload.ordinary.value]).toEqual(expected);
    };

    assertState(fake.initial, [0, 10, 20]);
    proto.setData({value: 1});
    constructor.setData({value: 11});
    ordinary.setData({value: 21});

    expect(fake.sent.map(item => item.action)).toEqual([
        '__proto__/update', 'constructor/update', 'ordinary/update'
    ]);
    assertState(fake.sent[0].state, [1, 10, 20]);
    assertState(fake.sent[1].state, [1, 11, 20]);
    assertState(fake.sent[2].state, [1, 11, 21]);

    dispose();
});

test('jump and rollback consume only own payload names and never echo time travel', () => {
    const proto = new Carburetor({value: 0});
    const constructor = new Carburetor({value: 10});
    const ordinary = new Carburetor({value: 20});
    const fake = createExtension();
    const stores = Object.fromEntries([['__proto__', proto], ['constructor', constructor], ['ordinary', ordinary]]);
    const fromJSONCalls = {proto: 0, constructor: 0};
    const originalProto = proto.fromJSON.bind(proto);
    const originalConstructor = constructor.fromJSON.bind(constructor);
    proto.fromJSON = (value: unknown) => { fromJSONCalls.proto++; originalProto(value); };
    constructor.fromJSON = (value: unknown) => { fromJSONCalls.constructor++; originalConstructor(value); };
    const dispose = connectDevTools(stores, {extension: fake.extension});

    const emit = (type: EDevToolsAction, entries: Array<[string, {value: number}]>) => {
        fake.emit({type: EDevToolsMessageType.Dispatch, payload: {type},
            state: JSON.stringify(Object.fromEntries(entries))});
    };

    for (const action of [EDevToolsAction.JumpToAction, EDevToolsAction.JumpToState, EDevToolsAction.Rollback]) {
        emit(action, [['ordinary', {value: 21}]]);
        expect(fromJSONCalls).toEqual({proto: 0, constructor: 0});
        expect(proto.getData().value).toBe(0);
        expect(constructor.getData().value).toBe(10);
    }

    emit(EDevToolsAction.JumpToAction, [['__proto__', {value: 2}], ['constructor', {value: 12}]]);
    expect([proto.getData().value, constructor.getData().value]).toEqual([2, 12]);
    emit(EDevToolsAction.Rollback, [['__proto__', {value: 3}], ['constructor', {value: 13}]]);
    expect([proto.getData().value, constructor.getData().value]).toEqual([3, 13]);
    expect(fromJSONCalls).toEqual({proto: 2, constructor: 2});
    expect(fake.sent).toEqual([]);

    ordinary.setData({value: 22});
    const published = fake.sent[0].state as Record<string, {value: number}>;
    expect(own(published, '__proto__')).toBe(true);
    expect(own(published, 'constructor')).toBe(true);
    expect([published.__proto__.value, published.constructor.value, published.ordinary.value]).toEqual([3, 13, 22]);

    dispose();
});
