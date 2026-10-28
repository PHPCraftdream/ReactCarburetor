import {WriteLog} from "@/Carburetor/Store/Paths/WriteLog";

describe('WriteLog additional branches', () => {
    test('tracks on demand and captures target attribution', () => {
        const log = new WriteLog(16, false);
        const target = {};
        log.record(1, new Set(['node.value']));
        expect(log.targetsSince(0)).toBeUndefined();
        log.track(1);
        log.record(2, new Set(['node.value']), [['node.value', target]]);
        expect(log.targetsSince(1)?.get('node.value')?.has(target)).toBe(true);
        log.untrack();
        expect(log.targetsSince(2)).toBeUndefined();
    });
});
