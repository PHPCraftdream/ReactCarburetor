import {IWritePatch, TPatchPort} from "@/Carburetor/Models/Paths";
import {installPatch} from "@/Carburetor/Store/Paths/Diff/installPatch";
import {createWriteProxy} from "@/Carburetor/Store/Tracking/createWriteProxy";

test('direct root assignment creates an own literal data key', () => {
    const source: Record<string, unknown> = {};
    const paths: string[] = [];
    const draft = createWriteProxy(source, path => paths.push(path));
    draft['__proto__'] = {x: 1};

    expect(Object.getPrototypeOf(source)).toBe(Object.prototype);
    expect(Object.keys(source)).toEqual(['__proto__']);
    expect(source['__proto__']).toEqual({x: 1});
    expect(paths).toContain('__proto__');
});

test('refused literal prototype writes record neither paths nor patches', () => {
    const source = Object.preventExtensions({});
    const paths: string[] = [];
    const patches: unknown[] = [];
    const port: TPatchPort = {listener: patch => patches.push(patch)};
    const draft = createWriteProxy(source, path => paths.push(path), '', undefined, undefined, port);

    expect(Reflect.set(draft, '__proto__', {x: 1})).toBe(false);
    expect(Reflect.defineProperty(draft, '__proto__', {
        value: {x: 1}, writable: true, enumerable: true, configurable: true,
    })).toBe(false);
    expect(Object.getPrototypeOf(source)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(source, '__proto__')).toBe(false);
    expect(paths).toEqual([]);
    expect(patches).toEqual([]);
});

test('patch installation creates a literal own key and never traverses an inherited prototype', () => {
    const root: Record<string, unknown> = {branch: {}};
    const patch: IWritePatch = {
        segments: ['branch', '__proto__'], previousExists: false, previous: undefined,
        nextExists: true, next: {x: 1},
    };

    installPatch(root, patch, false);
    const branch = root.branch as Record<string, unknown>;
    expect(Object.getPrototypeOf(branch)).toBe(Object.prototype);
    expect(Object.keys(branch)).toEqual(['__proto__']);
    expect(branch['__proto__']).toEqual({x: 1});
    installPatch(root, patch, true);
    expect(Object.keys(branch)).toEqual([]);
    expect(Object.getPrototypeOf(branch)).toBe(Object.prototype);

    expect(() => installPatch(root, {
        segments: ['__proto__', 'polluted'], previousExists: false, previous: undefined,
        nextExists: true, next: true,
    }, false)).toThrow(/own segment/);
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
});
