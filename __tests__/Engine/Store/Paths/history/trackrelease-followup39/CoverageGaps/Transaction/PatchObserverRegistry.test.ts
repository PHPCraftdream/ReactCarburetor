import {rstest} from '@rstest/core';
import {PatchObserverRegistry} from "@/Carburetor/Store/Transaction/PatchObserverRegistry";
import {IPatchObserver, PATCH_OPAQUE, STATE_MUTATION_PUBLICATION, TPatchPort} from "@/Carburetor/Models/Paths";
import {IUpdateScheduler} from "@/Carburetor/Models/Store";

const stage = () => {
    const port: TPatchPort = {};
    const scheduled = new Map<string, () => void>();
    const canceled: string[] = [];
    const scheduler: IUpdateScheduler = {
        schedule: (key, callback) => { scheduled.set(key, callback); },
        cancel: (key) => { canceled.push(key); scheduled.delete(key); },
    };

    return {port, scheduled, canceled, registry: new PatchObserverRegistry(port, scheduler)};
};

describe('PatchObserverRegistry', () => {
    test('a second patch-only observer replaces the first, and a stale disposer does nothing', () => {
        const {port, registry} = stage();
        const first: IPatchObserver = {patch: rstest.fn()};
        const second: IPatchObserver = {patch: rstest.fn()};
        const disposeFirst = registry.attach(first);
        const disposeSecond = registry.attach(second);

        port.listener?.(PATCH_OPAQUE);
        expect(first.patch).not.toHaveBeenCalled();
        expect(second.patch).toHaveBeenCalledTimes(1);
        expect(second.patch).toHaveBeenCalledWith(PATCH_OPAQUE);

        disposeFirst();
        disposeFirst();
        port.listener?.(PATCH_OPAQUE);
        expect(second.patch).toHaveBeenCalledTimes(2);

        disposeSecond();
        expect(port.listener).toBeUndefined();
    });

    test('patches fan out to every registration; a publication reaches only the observer that asks for it', () => {
        const {port, scheduled, canceled, registry} = stage();
        const patchOnly: IPatchObserver = {patch: rstest.fn()};
        const history: IPatchObserver = {patch: rstest.fn(), publication: rstest.fn()};
        registry.attach(patchOnly);
        const disposeHistory = registry.attach(history);

        port.listener?.(PATCH_OPAQUE);
        expect(patchOnly.patch).toHaveBeenCalledTimes(1);
        expect(history.patch).toHaveBeenCalledTimes(1);

        expect(registry.publish()).toBeUndefined();
        expect(scheduled.size).toBe(1);
        expect(history.publication).not.toHaveBeenCalled();

        const [[key, deliver]] = [...scheduled];
        deliver();
        expect(history.publication).toHaveBeenCalledTimes(1);
        expect(history.publication).toHaveBeenCalledWith(STATE_MUTATION_PUBLICATION);
        // Delivered, so no longer pending: the same callback run again publishes nothing.
        deliver();
        expect(history.publication).toHaveBeenCalledTimes(1);

        disposeHistory();
        expect(canceled).toEqual([key]);
        port.listener?.(PATCH_OPAQUE);
        expect(patchOnly.patch).toHaveBeenCalledTimes(2);
        expect(history.patch).toHaveBeenCalledTimes(1);
    });
});
