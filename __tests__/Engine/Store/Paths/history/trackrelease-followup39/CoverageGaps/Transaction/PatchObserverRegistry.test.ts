import {rstest} from '@rstest/core';
import {PatchObserverRegistry} from "@/Carburetor/Store/Transaction/PatchObserverRegistry";
import {IPatchObserver, STATE_MUTATION_PUBLICATION} from "@/Carburetor/Models/Paths";
import {IUpdateScheduler} from "@/Carburetor/Models/Store";

describe('PatchObserverRegistry', () => {
    test('replaces patch-only observers, dispatches active registrations, and detaches idempotently', () => {
        const port: {listener?: (patch: never) => void} = {};
        const scheduled = new Map<string, () => void>();
        const canceled: string[] = [];
        const scheduler: IUpdateScheduler = {
            schedule: (key, callback) => { scheduled.set(key, callback); },
            cancel: (key) => { canceled.push(key); scheduled.delete(key); },
        };
        const registry = new PatchObserverRegistry(port as never, scheduler);
        const first: IPatchObserver = {patch: rstest.fn()};
        const second: IPatchObserver = {patch: rstest.fn()};
        const disposeFirst = registry.attach(first);
        registry.attach(second);
        expect(first.patch).not.toHaveBeenCalled();
        expect(second.patch).not.toHaveBeenCalled();
        disposeFirst();
        disposeFirst();
        expect(port.listener).toBeDefined();
        expect(canceled).toEqual([]);
        const third: IPatchObserver = {patch: rstest.fn()};
        registry.attach(third);
        expect(second.patch).not.toHaveBeenCalled();
        expect(registry.publish()).toBeUndefined();
        expect(registry.claimRestore({})).toBeUndefined();
        registry.markPendingInstall();
        expect(scheduled.size).toBe(0);
        expect(STATE_MUTATION_PUBLICATION.origin).toBe('mutation');
    });
});
