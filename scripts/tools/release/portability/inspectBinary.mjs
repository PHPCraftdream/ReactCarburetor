import { parseElf } from './elf.mjs';
import { parseMacho } from './macho.mjs';
import { parsePe } from './pe.mjs';

/** Reads a native executable and reports how it links, whichever platform it targets.
 *
 * @param bytes - The whole executable.
 * @returns {object} `{format: 'elf'|'pe'|'macho', arch, ...}`, with the fields of the matching parser.
 * @throws When the file is none of the three formats.
 */
export function inspectBinary(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 4 && view.getUint32(0, false) === 0x7f454c46) return { format: 'elf', ...parseElf(bytes) };
  if (bytes.length >= 2 && view.getUint16(0, true) === 0x5a4d) return { format: 'pe', ...parsePe(bytes) };
  if (bytes.length >= 4 && view.getUint32(0, true) === 0xfeedfacf) return { format: 'macho', ...parseMacho(bytes) };
  throw new Error('Not an ELF, PE or thin Mach-O executable');
}
