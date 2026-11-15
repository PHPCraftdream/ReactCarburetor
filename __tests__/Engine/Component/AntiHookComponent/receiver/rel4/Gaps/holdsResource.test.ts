import {Carburetor} from '@/Carburetor';
import type {IDependencySlot} from '@/Carburetor/Component/Models/Connection';
import {holdsResource} from '@/Carburetor/Component/Models/holdsResource';

const source = new Carburetor({n: 0});
const other = new Carburetor({n: 0});

const filedFor = (owner: Carburetor<{n: number}>, paths?: string[]): IDependencySlot => ({
    installed: {carburetor: owner, reads: new Set() as never},
    committed: {
        carburetor: owner,
        baselineVersion: 0,
        reads: new Set() as never,
        resourcePaths: paths === undefined ? undefined : new Set(paths),
    },
});

describe('holdsResource', () => {
    test('is true for a registered, committed slot whose commit read the entry', () => {
        expect(holdsResource(filedFor(source, ['a', 'b']), source, 'b')).toBe(true);
    });

    test('is false for an entry the commit did not read, or when it recorded none', () => {
        expect(holdsResource(filedFor(source, ['a']), source, 'b')).toBe(false);
        expect(holdsResource(filedFor(source), source, 'a')).toBe(false);
    });

    test('is false once the slot lost its registration or its commit', () => {
        const registered = filedFor(source, ['a']);

        expect(holdsResource({...registered, installed: undefined}, source, 'a')).toBe(false);
        expect(holdsResource({...registered, committed: undefined}, source, 'a')).toBe(false);
    });

    test('is false when the registration or the commit belongs to another source', () => {
        const registered = filedFor(source, ['a']);
        const foreign = filedFor(other, ['a']);

        expect(holdsResource({...registered, installed: foreign.installed}, source, 'a')).toBe(false);
        expect(holdsResource({...registered, committed: foreign.committed}, source, 'a')).toBe(false);
        expect(holdsResource(foreign, source, 'a')).toBe(false);
    });
});
