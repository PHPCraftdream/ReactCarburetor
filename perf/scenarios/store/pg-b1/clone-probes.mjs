/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {countCalls} from './count-calls.mjs';

// Direct deepClone windows exclude constructor/snapshot bookkeeping and fixture setup.
export const cloneProbes = (deepClone, rows) => {
    const ordinary = Array.from({length: rows}, (_, id) => ({id, title: `Row ${id}`}));
    const proto = {['__proto__']: {value: 7}};
    const emptyOwn = countCalls(Reflect, 'ownKeys', () => undefined);
    const own = countCalls(Reflect, 'ownKeys', () => deepClone(ordinary));
    const ownControl = countCalls(Reflect, 'ownKeys', () => Reflect.ownKeys(ordinary[0]));
    const emptyDefine = countCalls(Object, 'defineProperty', () => undefined);
    const define = countCalls(Object, 'defineProperty', () => deepClone(ordinary));
    const defineControl = countCalls(Object, 'defineProperty', () => deepClone(proto));
    const copied = [own.value, define.value].every(copy => copy !== ordinary
        && copy.every((row, id) => row !== ordinary[id] && row.id === id && row.title === `Row ${id}`));
    const protoCopy = defineControl.value;
    return {
        cloneOwnKeys: own.calls, cloneDefineProperties: define.calls,
        emptyOwnKeys: emptyOwn.calls, emptyDefineProperties: emptyDefine.calls,
        ownKeysControl: ownControl.calls, protoDefineControl: defineControl.calls,
        cloneCopied: copied,
        protoCopied: Object.hasOwn(protoCopy, '__proto__') && protoCopy.__proto__ !== proto.__proto__
            && protoCopy.__proto__.value === 7 && Object.getPrototypeOf(protoCopy) === Object.prototype,
    };
};
