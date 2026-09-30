import {ComponentUpdateThrottle} from "@/Carburetor";

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

    test('a throwing updater does not lose its batch nor wedge the scheduler', async () => {
        const original = console.error;
        const reported: string[] = [];
        const throttle = new ComponentUpdateThrottle(10);

        values = [];
        console.error = (message: string) => reported.push(message);

        try {
            throttle.schedule('1', () => {
                throw new Error('updater failed');
            });
            throttle.schedule('2', addB);

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(values).toEqual(['b']);

            // The window after the failure has to arm again; staying silent here is the
            // permanently-wedged scheduler this test exists to catch.
            throttle.schedule('3', addC);

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(values).toEqual(['b', 'c']);
        } finally {
            console.error = original;
        }

        expect(reported.length).toEqual(1);
        expect(reported[0]).toContain('updater failed');
    });

    // R15-07: runUpdater and schedule were arrow fields, so a subclass method override of
    // either was silently ignored — the override lived on the prototype, but the base
    // constructor's own arrow field already sat on the instance, shadowing it.
    test('a subclass runUpdater() method override runs, and super.runUpdater still works', async () => {
        const ran: string[] = [];

        class LoggingThrottle extends ComponentUpdateThrottle {
            protected runUpdater(updater: () => void): void {
                ran.push('logged');
                super.runUpdater(updater);
            }
        }

        const throttle = new LoggingThrottle(10);
        let updaterRan = false;

        throttle.schedule('1', () => {
            updaterRan = true;
        });

        await new Promise(resolve => setTimeout(resolve, 30));

        expect(ran).toEqual(['logged']);
        expect(updaterRan).toBeTruthy();
    });

    test('a subclass schedule() method override runs, and super.schedule still flushes on the timer', async () => {
        const calls: string[] = [];

        class LoggingThrottle extends ComponentUpdateThrottle {
            public schedule(uid: string, updater: () => void): void {
                calls.push(uid);
                super.schedule(uid, updater);
            }
        }

        const throttle = new LoggingThrottle(10);
        let ran = false;

        throttle.schedule('x', () => {
            ran = true;
        });

        expect(calls).toEqual(['x']);
        expect(ran).toBeFalsy();

        await new Promise(resolve => setTimeout(resolve, 30));

        expect(ran).toBeTruthy();
    });
});
