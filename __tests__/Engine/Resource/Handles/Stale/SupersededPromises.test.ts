import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {ResourceCarburetor} from "@/Carburetor/Resource/ResourceCarburetor";
import {deferred} from "../../Resource/Keys/helpers";

describe('ResourceCarburetor superseded handle promises', () => {
    test('a load superseded by a same-key refresh resolves when the refresh settles, not while Pending', async () => {
        const gates = [deferred<string>(), deferred<string>()];
        const signals: AbortSignal[] = [];
        let calls = 0;
        const resource = new ResourceCarburetor<string, [string]>((_key, signal) => {
            signals.push(signal);

            return gates[calls++].promise;
        });

        const first = resource.load('a');
        const second = resource.refresh('a');

        expect(signals[0].aborted).toBe(true);
        expect(resource.getData().status).toBe(EResourceStatus.Pending);

        gates[1].resolve('second');
        await first;
        await second;

        expect(resource.getData().status).toBe(EResourceStatus.Success);
        expect(resource.getData().data).toBe('second');
    });

    test('a load superseded by a different key keeps its own resolution', async () => {
        const gates = {a: deferred<string>(), b: deferred<string>()};
        const resource = new ResourceCarburetor<string, ['a' | 'b']>((key) => gates[key].promise);

        const first = resource.load('a');
        const second = resource.load('b');

        gates.b.resolve('bee');
        await second;
        gates.a.resolve('ay');
        await first;

        expect(resource.getData().data).toBe('bee');
        expect(resource.getData().status).toBe(EResourceStatus.Success);
    });
});
