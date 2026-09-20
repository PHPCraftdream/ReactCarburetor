import {ComponentUpdateThrottle} from "../lib/src/Carburetor";

describe('ComponentUpdateThrottle', () => {
    let values: string[] = [];

    const addA = () => values.push('a');
    const addB = () => values.push('b');
    const addC = () => values.push('c');

    const componentUpdateThrottle = new ComponentUpdateThrottle();

    test('coalesces repeated updates of the same uid', async () => {
        values = [];

        componentUpdateThrottle.schedule('1', addA);
        componentUpdateThrottle.schedule('2', addB);
        componentUpdateThrottle.schedule('1', addC);
        expect(values).toEqual([]);

        await new Promise(resolve => setTimeout(resolve, 100));

        expect(values).toEqual(['c', 'b']);
    });

    test('runs every scheduled uid once', async () => {
        values = [];

        componentUpdateThrottle.schedule('1', addA);
        componentUpdateThrottle.schedule('2', addB);
        componentUpdateThrottle.schedule('3', addC);
        expect(values).toEqual([]);

        await new Promise(resolve => setTimeout(resolve, 100));

        expect(values).toEqual(['a', 'b', 'c']);
    });

    test('cancel drops a pending update', async () => {
        values = [];

        componentUpdateThrottle.schedule('1', addA);
        componentUpdateThrottle.schedule('2', addB);
        componentUpdateThrottle.cancel('1');

        await new Promise(resolve => setTimeout(resolve, 100));

        expect(values).toEqual(['b']);
    });

    test('runs updates scheduled while flushing', async () => {
        values = [];

        componentUpdateThrottle.schedule('1', () => {
            addA();
            componentUpdateThrottle.schedule('2', addB);
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        expect(values).toEqual(['a', 'b']);
    });
});
