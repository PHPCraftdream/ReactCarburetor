const CPUS = { 0x01000007: 'x64', 0x0100000c: 'arm64' };
const LC_LOAD_DYLIB = 0xc;
const LC_LOAD_WEAK_DYLIB = 0x80000018;
const LC_REEXPORT_DYLIB = 0x8000001f;
const LC_VERSION_MIN_MACOSX = 0x24;
const LC_BUILD_VERSION = 0x32;
const PLATFORM_MACOS = 1;

/** Formats a packed Mach-O version (`xxxx.yy.zz`) as `major.minor`.
 *
 * @param packed - The 32-bit packed version.
 * @returns {string} The version without the patch level.
 */
const version = packed => `${packed >>> 16}.${(packed >>> 8) & 0xff}`;

/** Reads the dylibs and the minimum macOS version of a thin 64-bit Mach-O executable.
 *
 * @param bytes - The whole executable.
 * @returns {{arch: string, dylibs: string[], minos: string|null}} Architecture, linked libraries
 * and the deployment target (`null` when the file declares none).
 * @throws When the file is not a thin little-endian 64-bit Mach-O executable.
 */
export function parseMacho(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 32 || view.getUint32(0, true) !== 0xfeedfacf) {
    throw new Error('Only thin little-endian 64-bit Mach-O executables are supported');
  }
  const cpu = view.getUint32(4, true);
  const commandCount = view.getUint32(16, true);
  const dylibs = [];
  let minos = null;
  let offset = 32;
  for (let index = 0; index < commandCount; index += 1) {
    const command = view.getUint32(offset, true);
    const size = view.getUint32(offset + 4, true);
    if ([LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB, LC_REEXPORT_DYLIB].includes(command)) {
      const start = offset + view.getUint32(offset + 8, true);
      let end = start;
      while (end < offset + size && bytes[end] !== 0) end += 1;
      dylibs.push(Buffer.from(bytes.subarray(start, end)).toString('utf8'));
    } else if (command === LC_BUILD_VERSION && view.getUint32(offset + 8, true) === PLATFORM_MACOS) {
      minos = version(view.getUint32(offset + 12, true));
    } else if (command === LC_VERSION_MIN_MACOSX) {
      minos = version(view.getUint32(offset + 8, true));
    }
    offset += size;
  }
  return { arch: CPUS[cpu] ?? `cpu-${cpu}`, dylibs: dylibs.sort((a, b) => a.localeCompare(b)), minos };
}
