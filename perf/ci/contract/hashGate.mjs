/* oxlint-disable carburetor-internal/require-tsdoc */
import {createHash} from 'node:crypto';

const canonical = value => Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
        : value;

/** Hashes the manifest values (ids, scenarios, args, nodeArgs, gates, requires); comments and key order are ignored. */
export const hashGateManifest = manifest =>
    createHash('sha256').update(JSON.stringify(canonical(manifest))).digest('hex');
