import {WriteLog} from '@/Carburetor/Store/Paths/WriteLog';
import {WriteTargetLedger} from '@/Carburetor/Store/Utils/Graph/WriteTargetLedger';

interface IProof {
    paths: Map<string, Set<object>>;
    count: number;
}
interface ILog {last: Map<string, number>; targets: IProof; recent: {entries: Map<string, unknown>}}
const inspect = (log: WriteLog): ILog => log as unknown as ILog;
const publish = (log: WriteLog, version: number, path: string, target: object): void => {
    log.record(version, new Set([path]), [[path, target]]);
};

describe('bounded retained structures and recent-path work (R39-01/R39-04)', () => {
    test('repeated writes reuse one path node and one raw pair regardless of publication count', () => {
        const log = new WriteLog();
        const raw = {};
        for (let version = 1; version <= 10000; version++) publish(log, version, 'tick', raw);
        const state = inspect(log);
        expect(state.recent.entries.size).toBe(1);
        expect(state.targets.paths.size).toBe(1);
        expect(state.targets.count).toBe(1);
        expect(log.targetsSince(0)?.get('tick')?.size).toBe(1);
    });

    test('pathsSince does not iterate last or older recent nodes and returns last-write order', () => {
        const log = new WriteLog();
        for (let version = 1; version <= 4000; version++) publish(log, version, `p${version}`, {});
        const state = inspect(log);
        state.last[Symbol.iterator] = (): MapIterator<[string, number]> => { throw new Error('scanned last'); };
        const old = state.recent.entries.get('p3999') as {previous?: unknown};
        Object.defineProperty(old, 'previous', {get: () => { throw new Error('scanned old node'); }});
        expect(log.pathsSince(3999)).toEqual(['p4000']);
        publish(log, 4001, 'p1', {});
        expect(log.pathsSince(3999)).toEqual(['p4000', 'p1']);
    });

    test.each(['wildcard', 'incomplete', 'missing', 'publication-overflow', 'ordinary-overflow'])
    ('%s releases accumulated/cache references and accepts a fresh proof', kind => {
        const log = new WriteLog(kind === 'ordinary-overflow' ? 2 : 8192);
        publish(log, 1, 'old', {});
        expect(log.targetsSince(0)).toBeDefined();
        if (kind === 'wildcard') log.record(2, new Set(['*']), [['*', {}]]);
        else if (kind === 'incomplete') log.record(2, new Set(['old']), [['old', {}]], true);
        else if (kind === 'missing') log.record(2, new Set(['old']), []);
        else if (kind === 'publication-overflow') {
            log.record(2, new Set(['old']), Array.from({length: 1025}, () => ['old', {}] as const));
        } else log.record(2, new Set(['a', 'b', 'c']), [['a', {}], ['b', {}], ['c', {}]]);
        const proof = inspect(log).targets;
        expect(proof.paths.size).toBe(0);
        expect(proof.count).toBe(0);
        expect(log.targetsSince(1)).toBeUndefined();
        publish(log, 3, 'fresh', {});
        expect(log.targetsSince(2)?.has('fresh')).toBe(true);
        expect(log.targetsSince(2)?.has('old')).toBe(false);
    });

    test('cumulative overflow releases every retained pair and the materialized cache', () => {
        const log = new WriteLog();
        for (let version = 1; version <= 2048; version++) publish(log, version, 'same', {});
        expect(inspect(log).targets.count).toBe(2048);
        expect(log.targetsSince(0)?.get('same')?.size).toBe(2048);
        publish(log, 2049, 'same', {});
        expect(inspect(log).targets.count).toBe(0);
        expect(inspect(log).targets.paths.size).toBe(0);
        publish(log, 2050, 'fresh', {});
        expect(log.targetsSince(2049)?.has('same')).toBe(false);
    });

    test('pending buffer identity is reused and reset drops every raw reference including incomplete state', () => {
        const ledger = new WriteTargetLedger();
        const buffer = ledger.entries;
        for (let index = 0; index < 4097; index++) ledger.add(`p${index}`, {});
        expect(buffer).toHaveLength(4096);
        expect(ledger.isIncomplete).toBe(true);
        ledger.reset();
        expect(ledger.entries).toBe(buffer);
        expect(buffer).toHaveLength(0);
        expect(ledger.isIncomplete).toBe(false);
        ledger.add('next', {});
        expect(buffer).toHaveLength(1);
    });
});
