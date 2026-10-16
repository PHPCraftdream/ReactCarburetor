import {TResourceKey} from "@/Carburetor/Models/Resource";

/** Rejects a malformed `key` option at construction, before it can hide a broken call. */
export const validateResourceKey = (key: TResourceKey<never> | undefined): TResourceKey<never> => {
    if (typeof key !== 'function') throw new TypeError('resource key option must be a function');
    return key;
};
