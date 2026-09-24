import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {ResourceCarburetor} from "@/Carburetor/Resource/ResourceCarburetor";
import {deferred} from "./helpers";

describe('ResourceCarburetor reentrant loads', () => {
    test('a synchronous subscriber joins the request before the loader runs', async () => {
        const gate = deferred<string>();
        let calls = 0;
        const resource = new ResourceCarburetor<string, string>(() => {
            calls++;

            return gate.promise;
        });
        let joined: Promise<void> | undefined;
        let reentered = false;

        resource.subscribe(() => {
            if (!reentered) {
                reentered = true;
                joined = resource.load('a');
            }
        }, {id: 'reentrant'});

        const request = resource.load('a');

        expect(joined).toBe(request);
        expect(calls).toEqual(1);
        expect(resource.getData().status).toEqual(EResourceStatus.Pending);

        gate.resolve('loaded');
        await request;

        expect(resource.getData().data).toEqual('loaded');
        expect(resource.getData().status).toEqual(EResourceStatus.Success);
    });

    test('a distinct key started by a subscriber replaces and aborts the first request', async () => {
        const gates = {a: deferred<string>(), b: deferred<string>()};
        const started: Array<{key: string; signal: AbortSignal}> = [];
        const resource = new ResourceCarburetor<string, 'a' | 'b'>((key, signal) => {
            started.push({key, signal});

            return gates[key].promise;
        });
        let second: Promise<void> | undefined;
        let switched = false;

        resource.subscribe(() => {
            if (!switched) {
                switched = true;
                second = resource.load('b');
            }
        }, {id: 'replace'});

        const first = resource.load('a');

        expect(started).toHaveLength(1);
        expect(started[0].key).toBe('b');
        expect(started[0].signal.aborted).toBe(false);

        gates.b.resolve('current');
        await Promise.all([first, second]);

        expect(resource.getData().data).toEqual('current');
        expect(resource.getData().status).toEqual(EResourceStatus.Success);
    });

    test('abort during notification keeps late settlement from replacing idle', async () => {
        let calls = 0;
        const resource = new ResourceCarburetor<string, string>(() => {
            calls++;

            return Promise.resolve('late');
        });

        resource.subscribe(() => resource.abort(), {id: 'abort'});

        const request = resource.load('a');

        expect(calls).toEqual(0);
        expect(resource.getData().status).toEqual(EResourceStatus.Idle);

        await request;

        expect(resource.getData().status).toEqual(EResourceStatus.Idle);
        expect(resource.getData().data).toBeUndefined();
    });
});
