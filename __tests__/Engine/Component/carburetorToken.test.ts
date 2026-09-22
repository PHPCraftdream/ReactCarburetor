import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {Carburetor, carburetorToken, getUid} from '@/Carburetor';

/**
 * A token's id has to be the same string in two processes: the server serializes scope state
 * under it and the client matches on it, and neither side sees the other's module graph. Tests
 * in one process share one registry, so they can never catch the two sides disagreeing — the
 * regression below runs the halves as real child processes that each build their tokens through
 * the compiled package, in opposite creation orders.
 */
const ENTRY = path.resolve(process.cwd(), 'dist', 'cjs', 'Carburetor', 'index.js');

const runNode = (script: string, extraEnv: Record<string, string> = {}) => {
    const result = spawnSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        env: {...process.env, CARBURETOR_ENTRY: ENTRY, ...extraEnv},
    });

    if (result.error) {
        throw result.error;
    }

    return {status: result.status, stdout: result.stdout || ''};
};

// Each side is a whole process. The server declares and instantiates an extra carburetor the
// client never makes, before the shared token; the client declares the shared token first.
// When tokens drew ids from getUid()'s shared counter, that order difference alone put the
// server's data under an id the client's token did not hold, and hydration silently skipped it.
const SERVER_SCRIPT = `
const lib = require(process.env.CARBURETOR_ENTRY);
const warmup = lib.carburetorToken(() => new lib.Carburetor({value: 0}), 'hydration-e2e/warmup');
const shared = lib.carburetorToken(() => new lib.Carburetor({value: 42}), 'hydration-e2e/counter');
const scope = new lib.CarburetorScope();
scope.get(warmup);
scope.get(shared);
process.stdout.write(JSON.stringify({wire: scope.dehydrate(), sharedId: shared.id}));
`;

// The client also checks the warmup carburetor: a shared counter would make the server's
// counter payload land on the client's warmup token instead, so its staying at 0 is part
// of what this proves.
const CLIENT_SCRIPT = `
const lib = require(process.env.CARBURETOR_ENTRY);
const shared = lib.carburetorToken(() => new lib.Carburetor({value: 0}), 'hydration-e2e/counter');
const warmup = lib.carburetorToken(() => new lib.Carburetor({value: 0}), 'hydration-e2e/warmup');
const sent = JSON.parse(process.env.CARBURETOR_WIRE);
const scope = new lib.CarburetorScope();
scope.hydrate(sent.wire, [shared, warmup]);
const sharedValue = scope.get(shared).getData().value;
const warmupValue = scope.get(warmup).getData().value;
process.stdout.write(JSON.stringify({sharedId: shared.id, sharedValue, warmupValue}));
if (sharedValue !== 42 || warmupValue !== 0) {
    process.exit(1);
}
`;

describe('carburetorToken', () => {
    test('the id is the given name, whatever the shared uid counter has handed out', () => {
        getUid();
        getUid();

        const token = carburetorToken(() => new Carburetor({value: 0}), 'hydration-e2e/in-process');

        expect(token.id).toEqual('hydration-e2e/in-process');
    });

    test('a second token claiming a taken name is rejected', () => {
        carburetorToken(() => new Carburetor({value: 0}), 'hydration-e2e/duplicate');

        expect(() => carburetorToken(() => new Carburetor({value: 0}), 'hydration-e2e/duplicate'))
            .toThrow(/already exists/);
    });

    test('an empty name is rejected', () => {
        expect(() => carburetorToken(() => new Carburetor({value: 0}), '')).toThrow(/non-empty/);
    });
});

describe('hydration across processes', () => {
    test('server and client agree on the shared token under opposite creation orders', () => {
        if (!existsSync(ENTRY)) {
            throw new Error('the compiled package is missing: run npm run build first, this regression hydrates through dist/cjs');
        }

        const server = runNode(SERVER_SCRIPT);

        expect(server.status).toEqual(0);

        const sent = JSON.parse(server.stdout);

        expect(sent.sharedId).toEqual('hydration-e2e/counter');

        const client = runNode(CLIENT_SCRIPT, {CARBURETOR_WIRE: server.stdout});

        expect(client.status).toEqual(0);

        const received = JSON.parse(client.stdout);

        expect(received.sharedId).toEqual('hydration-e2e/counter');
        expect(received.sharedValue).toEqual(42);
        expect(received.warmupValue).toEqual(0);
    });
});
