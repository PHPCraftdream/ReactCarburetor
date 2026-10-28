import {liveViews} from '@/Carburetor/Store/Tracking/Proxy/liveViews';
import {RAW_TARGET} from '@/Carburetor/Store/Tracking/Models';

describe('liveViews.note, noteTarget, readTarget, and has', () => {
    test('direct RAW_TARGET hatch resolves without registry setup', () => {
        const raw = {value: 1};
        let hatchReads = 0;
        const view = new Proxy({}, {
            get: (_target, key): unknown => {
                if (key === RAW_TARGET) {
                    hatchReads++;
                    return raw;
                }
                return undefined;
            },
        });
        expect(liveViews.readTarget(view)).toBe(raw);
        expect(liveViews.has(view)).toBe(true);
        expect(hatchReads).toBeGreaterThan(0);
    });

    test('note preserves a registered target and unregistered values stay unrecognized', () => {
        const raw = {};
        const view = {};
        liveViews.noteTarget(view, raw);
        liveViews.note(view);
        expect(liveViews.readTarget(view)).toBe(raw);
        expect(liveViews.has(view)).toBe(true);
        expect(liveViews.readTarget({})).toBeUndefined();
        expect(liveViews.has({})).toBe(false);
        expect(liveViews.has(null)).toBe(false);
        expect(liveViews.has(undefined)).toBe(false);
        expect(liveViews.has(1)).toBe(false);
    });

    test('diagnostic note is recognized without claiming a raw target', () => {
        const view = {};
        liveViews.note(view);
        expect(liveViews.has(view)).toBe(true);
        expect(liveViews.readTarget(view)).toBeUndefined();
    });

    test('dynamic target resolves on every read and can become undefined', () => {
        let current: object | undefined = {};
        let resolutions = 0;
        const view = {};
        liveViews.noteDynamicReadTarget(view, () => {
            resolutions++;
            return current;
        });
        expect(liveViews.readTarget(view)).toBe(current);
        current = {next: true};
        expect(liveViews.readTarget(view)).toBe(current);
        current = undefined;
        expect(liveViews.readTarget(view)).toBeUndefined();
        expect(liveViews.has(view)).toBe(true);
        expect(resolutions).toBe(3);
    });

    test('normalizes registered nested views, skips scalar data, and leaves the target untouched', () => {
        const raw = {value: 1};
        const view = {};
        liveViews.noteTarget(view, raw);
        const assigned: {child: object; number: number} = {child: view, number: 3};
        liveViews.normalizeAssigned(assigned);
        expect(assigned.child).toBe(raw);
        expect(assigned.number).toBe(3);
        expect(raw).toEqual({value: 1});
    });

    test('normalizes array members but leaves primitives and unregistered objects intact', () => {
        const raw = {};
        const view = {};
        liveViews.noteTarget(view, raw);
        const ordinary = {kept: true};
        const assigned: unknown[] = [view, 3, ordinary];
        liveViews.normalizeAssigned(assigned);
        expect(assigned).toEqual([raw, 3, ordinary]);
        expect(assigned[2]).toBe(ordinary);
    });

    test('does not walk untrackable values or treat a registered root as an assigned container', () => {
        const view = {};
        const raw = {};
        liveViews.noteTarget(view, raw);
        liveViews.normalizeAssigned(view);
        liveViews.normalizeAssigned(null);
        liveViews.normalizeAssigned(4);
        expect(liveViews.readTarget(view)).toBe(raw);
    });
});
