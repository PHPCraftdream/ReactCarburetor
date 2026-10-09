import {completeReads} from '@/Carburetor/Store/Tracking/Observation/completeReads';
import {readCoverage} from '@/Carburetor/Store/Paths/Markers/readCoverage';

test('R40-02 completion never caches mutable scratch at the same size', () => {
    const reads = new Set(['user.~p', 'user.name']);
    expect(completeReads(reads)).toBe(reads);
    expect([...reads]).toEqual(['user.name']);
    reads.clear();
    reads.add('user.~p');
    reads.add('other.name');
    completeReads(reads);
    expect([...reads]).toEqual(['user.~p', 'other.name']);
});

test('R40-02 retained coverage rebuilds after index-owned growth', () => {
    const reads = completeReads(new Set(['user.~p']));
    expect(readCoverage.covers(reads, 'user.~p')).toBe(true);
    expect(readCoverage.covers(reads, 'other.~p')).toBe(false);
    (reads as unknown as Set<string>).add('other.name');
    expect(readCoverage.covers(reads, 'other.~p')).toBe(true);
});

test('R40-02 presence does not cover itself, keys do, and prefixes are strict', () => {
    const presence = new Set(['user.~p']);
    completeReads(presence);
    expect([...presence]).toEqual(['user.~p']);
    const keys = new Set(['user.~p', 'user.~k', 'users.~p']);
    completeReads(keys);
    expect([...keys]).toEqual(['user.~k', 'users.~p']);
});

test('R40-02 patch extension retains identity or copies only for new dependencies', () => {
    const filed = completeReads(new Set(['user.name', 'items.r0.title']));
    const before = [...filed];
    expect(readCoverage.extend(filed, new Set(['user.~p', 'items.~p']))).toBe(filed);
    const grown = readCoverage.extend(filed, new Set(['other.~p', 'other.name', 'alone.~p']));
    expect(grown).not.toBe(filed);
    expect([...filed]).toEqual(before);
    expect([...grown]).toEqual([...before, 'other.name', 'alone.~p']);
    expect(readCoverage.covers(grown, 'other.~p')).toBe(true);
});

