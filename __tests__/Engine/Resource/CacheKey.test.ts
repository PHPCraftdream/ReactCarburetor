import {pathsIntersect, WILDCARD_PATH} from "@/Carburetor";
import {encodeCacheKey} from "@/Carburetor/Resource/Cache/encodeCacheKey";
import {escapeCacheKey} from "@/Carburetor/Resource/Cache/escapeCacheKey";

/**
 * The key has to survive being used as one path segment, which is the whole reason it is escaped.
 * The first test is the hazard itself, kept as a test so the reason cannot be forgotten: with raw
 * keys two unrelated entries become relatives and one wakes the other.
 */
const entryPath = (key: string): string => `entries.${key}`;

describe('cache keys', () => {
    test('a raw key containing the separator makes unrelated entries relatives', () => {
        const readerOfShortKey = new Set([entryPath('a')]);
        const writeToLongKey = new Set([entryPath('a.b')]);

        // Not a bug in path matching — `entries.a` genuinely is an ancestor of `entries.a.b`.
        // It is a bug in using an unescaped key as a segment, which is what the escape prevents.
        expect(pathsIntersect(readerOfShortKey, writeToLongKey)).toBeTruthy();
    });

    test('escaped keys keep the entries apart', () => {
        const readerOfShortKey = new Set([entryPath(encodeCacheKey('a'))]);
        const writeToLongKey = new Set([entryPath(encodeCacheKey('a.b'))]);

        expect(pathsIntersect(readerOfShortKey, writeToLongKey)).toBeFalsy();
    });

    test('a key never contains the path separator, whatever the arguments', () => {
        const keys = [
            encodeCacheKey('a.b.c'),
            encodeCacheKey({id: 'user.42', tags: ['a.b']}),
            encodeCacheKey([1.5, 2.25]),
            encodeCacheKey(1.5),
        ];

        keys.forEach((key: string) => {
            expect(key).not.toContain('.');
        });
    });

    test('the escape is reversible, so a key stays readable', () => {
        const decode = (key: string): string => key.split('~1').join('.').split('~0').join('~');

        expect(decode(encodeCacheKey({id: 'a.b'}))).toEqual('{"id":"a.b"}');
        expect(decode(encodeCacheKey('~1'))).toEqual('"~1"');
        // The tilde is escaped first, so an argument that already looks escaped survives.
        expect(encodeCacheKey('~1')).toEqual('"~01"');
    });

    test('equal arguments give one key, different arguments give different keys', () => {
        expect(encodeCacheKey({id: 7})).toEqual(encodeCacheKey({id: 7}));
        expect(encodeCacheKey({id: 7})).not.toEqual(encodeCacheKey({id: 8}));
        // Property order is the caller's; JSON keeps it, so this is a documented limit.
        expect(encodeCacheKey({a: 1, b: 2})).not.toEqual(encodeCacheKey({b: 2, a: 1}));
    });

    test('no arguments give one stable key', () => {
        expect(encodeCacheKey(undefined)).toEqual(encodeCacheKey(null));
        expect(encodeCacheKey(undefined)).toEqual('null');
    });

    test('a key can never be mistaken for the wildcard', () => {
        const keys = [encodeCacheKey('*'), encodeCacheKey({id: '*'}), encodeCacheKey(['*'])];

        keys.forEach((key: string) => {
            expect(key).not.toEqual(WILDCARD_PATH);
        });
    });

    test('the escaper of an already-serialized string is the exact second half of the encode', () => {
        expect(escapeCacheKey('{"id":"a.b"}')).toEqual(encodeCacheKey({id: 'a.b'}));
        // Tilde first, separator second — the same order, so an escaped-looking argument survives.
        expect(escapeCacheKey('"~1"')).toEqual('"~01"');
        expect(escapeCacheKey('"a.b"')).toEqual('"a~1b"');
    });
});
