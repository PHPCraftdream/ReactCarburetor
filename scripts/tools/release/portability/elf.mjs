const SHT_DYNAMIC = 6;
const SHT_GNU_VERNEED = 0x6ffffffe;
const PT_INTERP = 3;
const DT_NEEDED = 1;
const MACHINES = { 0x3e: 'x64', 0xb7: 'arm64' };

/** Reads a NUL-terminated string at an offset of a string table.
 *
 * @param bytes - The file contents.
 * @param offset - Start of the string.
 * @returns {string} The string, without its terminator.
 */
function cString(bytes, offset) {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  return Buffer.from(bytes.subarray(offset, end)).toString('latin1');
}

/** Reads a 64-bit field as a safe JavaScript number.
 *
 * @param view - DataView over the file.
 * @param offset - Field offset.
 * @returns {number} The value.
 */
const u64 = (view, offset) => Number(view.getBigUint64(offset, true));

/** Reads what a little-endian ELF64 binary needs from the system: interpreter, shared
 * libraries and symbol-version requirements.
 *
 * @param bytes - The whole binary.
 * @returns {{arch: string, interpreter: string|null, needed: string[],
 *   versions: Array<{file: string, name: string}>}} The binary's dynamic-linking facts.
 * @throws When the file is not a little-endian ELF64 binary with section headers.
 */
export function parseElf(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 64 || view.getUint32(0, false) !== 0x7f454c46) throw new Error('Not an ELF file');
  if (bytes[4] !== 2 || bytes[5] !== 1) throw new Error('Only little-endian ELF64 is supported');
  const arch = MACHINES[view.getUint16(18, true)] ?? `machine-${view.getUint16(18, true)}`;
  const phoff = u64(view, 32);
  const shoff = u64(view, 40);
  const phentsize = view.getUint16(54, true);
  const phnum = view.getUint16(56, true);
  const shentsize = view.getUint16(58, true);
  const shnum = view.getUint16(60, true);
  if (!shoff || !shnum) throw new Error('ELF file has no section headers');

  let interpreter = null;
  for (let index = 0; index < phnum; index += 1) {
    const header = phoff + index * phentsize;
    if (view.getUint32(header, true) === PT_INTERP) {
      interpreter = cString(bytes, u64(view, header + 8));
    }
  }

  const sections = [];
  for (let index = 0; index < shnum; index += 1) {
    const header = shoff + index * shentsize;
    sections.push({
      type: view.getUint32(header + 4, true),
      offset: u64(view, header + 24),
      size: u64(view, header + 32),
      link: view.getUint32(header + 40, true),
      info: view.getUint32(header + 44, true),
    });
  }

  const needed = [];
  const versions = [];
  for (const section of sections) {
    const strings = sections[section.link];
    if (section.type === SHT_DYNAMIC && strings) {
      for (let entry = section.offset; entry + 16 <= section.offset + section.size; entry += 16) {
        const tag = Number(view.getBigInt64(entry, true));
        if (tag === 0) break;
        if (tag === DT_NEEDED) needed.push(cString(bytes, strings.offset + u64(view, entry + 8)));
      }
    }
    if (section.type === SHT_GNU_VERNEED && strings) {
      let need = section.offset;
      for (let count = 0; count < section.info; count += 1) {
        const auxCount = view.getUint16(need + 2, true);
        const file = cString(bytes, strings.offset + view.getUint32(need + 4, true));
        let aux = need + view.getUint32(need + 8, true);
        for (let item = 0; item < auxCount; item += 1) {
          versions.push({ file, name: cString(bytes, strings.offset + view.getUint32(aux + 8, true)) });
          aux += view.getUint32(aux + 12, true);
        }
        need += view.getUint32(need + 12, true);
      }
    }
  }
  return { arch, interpreter, needed, versions };
}
