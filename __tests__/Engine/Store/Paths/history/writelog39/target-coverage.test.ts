import {WriteLog} from '@/Carburetor/Store/Paths/WriteLog';

const publish = (log: WriteLog, version: number, path: string, target: object): void => {
    log.record(version, new Set([path]), new Map([[path, new Set([target])]]));
};

describe('count-bounded target coverage (R39-01)', () => {
    test.each([2, 8, 64])('covers K=%i unrelated publications and the related write', (count) => {
        const log = new WriteLog();
        const root = {};
        const row = {};
        for (let version = 1; version <= count; version++) publish(log, version, 'tick', root);
        publish(log, count + 1, 'items.7.title', row);
        expect(log.pathsSince(0)).toEqual(['tick', 'items.7.title']);
        const targets = log.targetsSince(0);
        expect(targets).toBeDefined();
        expect(targets?.get('tick')?.has(root)).toBe(true);
        expect(targets?.get('items.7.title')?.has(row)).toBe(true);
    });

    test('keeps every raw alias target for a repeated path across publications', () => {
        const log = new WriteLog();
        const first = {};
        const second = {};
        publish(log, 1, 'outside.title', first);
        publish(log, 2, 'outside.title', second);
        publish(log, 3, 'tick', {});
        const targets = log.targetsSince(0);
        expect(targets).toBeDefined();
        expect(targets?.get('outside.title')?.has(first)).toBe(true);
        expect(targets?.get('outside.title')?.has(second)).toBe(true);
    });

    test.each(['missing', 'empty', 'incomplete'])('%s attribution cannot borrow an older target', (kind) => {
        const log = new WriteLog();
        publish(log, 1, 'outside.title', {});
        log.record(2, new Set(['outside.title']), kind === 'missing' ? undefined : new Map(), kind === 'incomplete');
        publish(log, 3, 'items.7.title', {});
        expect(log.pathsSince(0)).toEqual(['outside.title', 'items.7.title']);
        expect(log.targetsSince(0)).toBeUndefined();
        expect(log.targetsSince(2)?.get('items.7.title')?.size).toBe(1);
        // R39-01: after one conservative wake, the new baseline survives interleaving again.
        publish(log, 4, 'tick', {});
        publish(log, 5, 'items.7.title', {});
        expect(log.targetsSince(2)).toBeDefined();
    });

    test('cumulative cardinality overflow drops only raw history and recovers at the reset baseline', () => {
        const log = new WriteLog();
        for (let version = 1; version <= 2049; version++) publish(log, version, 'outside.title', {});
        expect(log.getWatermark()).toBe(0);
        expect(log.pathsSince(0)).toEqual(['outside.title']);
        expect(log.targetsSince(2048)).toBeUndefined();
        publish(log, 2050, 'tick', {});
        expect(log.targetsSince(2049)?.get('tick')?.size).toBe(1);
        publish(log, 2051, 'tick', {});
        publish(log, 2052, 'items.7.title', {});
        expect(log.targetsSince(2049)).toBeDefined();
    });
});
