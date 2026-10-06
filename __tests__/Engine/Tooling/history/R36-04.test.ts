import {Carburetor, CarburetorHistory, ComponentUpdateThrottle} from "@/Carburetor";

describe('R36-04 public replacement history', () => {
    test.each(['setData', 'restore', 'fromJSON'])('%s records a small public change as patches', operation => {
        const store = new Carburetor({rows: [{title: 'before'}]});
        const history = new CarburetorHistory(store);
        const next = {rows: [{title: 'after'}]};
        if (operation === 'setData') store.setData(next);
        else if (operation === 'restore') store.restore(next);
        else store.fromJSON(JSON.parse(JSON.stringify(next)));
        expect((history as unknown as {past: {kind: string}[]}).past.at(-1)?.kind).toBe('patches');
        expect(history.undo()).toBe(true);
        expect(store.getData()).toEqual({rows: [{title: 'before'}]});
        expect(history.redo()).toBe(true);
        expect(store.getData()).toEqual(next);
        history.disconnect();
    });

    test('bounded history retains only the configured number of replacement entries', () => {
        const store = new Carburetor({value: 0});
        const history = new CarburetorHistory(store, {limit: 2});
        for (let value = 1; value <= 4; value++) store.setData({value});
        expect((history as unknown as {past: {kind: string}[]}).past.map(entry => entry.kind)).toEqual(['patches', 'patches']);
        expect(history.undo()).toBe(true);
        expect(store.getData().value).toBe(3);
        expect(history.undo()).toBe(true);
        expect(store.getData().value).toBe(2);
        expect(history.undo()).toBe(false);
        history.disconnect();
    });

    test('large replacements fall back to opaque history without affecting state installation', () => {
        const store = new Carburetor({rows: Array.from({length: 1_100}, (_, value) => ({value: -value}))});
        const history = new CarburetorHistory(store);
        const next = {rows: Array.from({length: 1_100}, (_, value) => ({value}))};
        store.setData(next);
        expect(store.getData()).toEqual(next);
        expect((history as unknown as {past: {kind: string}[]}).past.map(entry => entry.kind)).toEqual(['snapshot']);
        expect(history.undo()).toBe(true);
        expect(store.getData().rows[0].value).toBe(-0);
        history.disconnect();
    });
    test('deferred public replacements coalesce into one patch entry', () => {
        class ManualThrottle extends ComponentUpdateThrottle {
            public flush(): void { this.letsUpdate(); }
        }
        const throttle = new ManualThrottle(60_000);
        const store = new Carburetor({value: 0}, throttle);
        const history = new CarburetorHistory(store);
        store.setData({value: 1});
        expect(history.canUndo()).toBe(false);
        throttle.flush();
        expect((history as unknown as {past: {kind: string}[]}).past.map(entry => entry.kind)).toEqual(['patches']);
        expect(history.undo()).toBe(true);
        expect(store.getData().value).toBe(0);
        history.disconnect();
    });
});
