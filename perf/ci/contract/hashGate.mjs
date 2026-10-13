/* oxlint-disable carburetor-internal/require-tsdoc */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

/** sha256 of a gate file with CRLF folded to LF, so a Windows checkout hashes like the recorded LF file. */
export const hashGate = path =>
    createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
