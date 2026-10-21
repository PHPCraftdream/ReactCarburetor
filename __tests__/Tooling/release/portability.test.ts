import {readFileSync} from 'node:fs';
import {parseElf} from '../../../scripts/tools/release/portability/elf.mjs';
import {parseMacho} from '../../../scripts/tools/release/portability/macho.mjs';
import {parsePe} from '../../../scripts/tools/release/portability/pe.mjs';
import {inspectBinary} from '../../../scripts/tools/release/portability/inspectBinary.mjs';
import {checkPortability} from '../../../scripts/tools/release/portability/check.mjs';
import {compareVersions, evaluatePortability} from '../../../scripts/tools/release/portability/evaluate.mjs';

/** A minimal little-endian ELF64 with one DT_NEEDED entry and two symbol-version requirements. */
const syntheticElf = (): Buffer => {
    const strings = Buffer.from('\0libc.so.6\0GLIBC_2.17\0GLIBC_2.34\0', 'latin1');
    const dynamic = Buffer.alloc(32);
    dynamic.writeBigInt64LE(1n, 0);
    dynamic.writeBigUInt64LE(1n, 8);
    const verneed = Buffer.alloc(48);
    verneed.writeUInt16LE(1, 0);
    verneed.writeUInt16LE(2, 2);
    verneed.writeUInt32LE(1, 4);
    verneed.writeUInt32LE(16, 8);
    verneed.writeUInt32LE(0, 12);
    verneed.writeUInt32LE(11, 16 + 8);
    verneed.writeUInt32LE(16, 16 + 12);
    verneed.writeUInt32LE(22, 32 + 8);
    verneed.writeUInt32LE(0, 32 + 12);
    const dataStart = 64;
    const stringsAt = dataStart;
    const dynamicAt = stringsAt + strings.length;
    const verneedAt = dynamicAt + dynamic.length;
    const tableAt = verneedAt + verneed.length;
    const file = Buffer.alloc(tableAt + 4 * 64);
    file.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
    file.writeUInt16LE(0x3e, 18);
    file.writeBigUInt64LE(BigInt(tableAt), 40);
    file.writeUInt16LE(64, 52);
    file.writeUInt16LE(64, 58);
    file.writeUInt16LE(4, 60);
    strings.copy(file, stringsAt);
    dynamic.copy(file, dynamicAt);
    verneed.copy(file, verneedAt);
    const section = (index: number, type: number, offset: number, size: number, link: number, info: number) => {
        const at = tableAt + index * 64;
        file.writeUInt32LE(type, at + 4);
        file.writeBigUInt64LE(BigInt(offset), at + 24);
        file.writeBigUInt64LE(BigInt(size), at + 32);
        file.writeUInt32LE(link, at + 40);
        file.writeUInt32LE(info, at + 44);
    };
    section(1, 3, stringsAt, strings.length, 0, 0);
    section(2, 6, dynamicAt, dynamic.length, 1, 0);
    section(3, 0x6ffffffe, verneedAt, verneed.length, 1, 1);
    return file;
};

/** A minimal PE32+ with one section and an import table naming the given DLLs. */
const syntheticPe = (machine: number, dlls: string[]): Buffer => {
    const optionalSize = 240;
    const sectionAt = 0x80 + 24 + optionalSize;
    const rawAt = 0x400;
    const rva = 0x1000;
    const names = dlls.map(name => Buffer.from(`${name}\0`, 'latin1'));
    const table = (dlls.length + 1) * 20;
    const file = Buffer.alloc(rawAt + table + names.reduce((total, name) => total + name.length, 0));
    file.writeUInt16LE(0x5a4d, 0);
    file.writeUInt32LE(0x80, 0x3c);
    file.writeUInt32LE(0x00004550, 0x80);
    file.writeUInt16LE(machine, 0x84);
    file.writeUInt16LE(1, 0x86);
    file.writeUInt16LE(optionalSize, 0x94);
    file.writeUInt16LE(0x20b, 0x98);
    file.writeUInt32LE(rva, 0x98 + 112 + 8);
    file.writeUInt32LE(table, 0x98 + 112 + 12);
    file.writeUInt32LE(file.length - rawAt, sectionAt + 8);
    file.writeUInt32LE(rva, sectionAt + 12);
    file.writeUInt32LE(file.length - rawAt, sectionAt + 16);
    file.writeUInt32LE(rawAt, sectionAt + 20);
    let nameAt = rawAt + table;
    names.forEach((name, index) => {
        file.writeUInt32LE(rva + (nameAt - rawAt), rawAt + index * 20 + 12);
        name.copy(file, nameAt);
        nameAt += name.length;
    });
    return file;
};

/** A minimal thin 64-bit Mach-O with LC_BUILD_VERSION and the given dylibs. */
const syntheticMacho = (cpu: number, minos: number, dylibs: string[]): Buffer => {
    const commands: Buffer[] = [];
    const build = Buffer.alloc(24);
    build.writeUInt32LE(0x32, 0);
    build.writeUInt32LE(24, 4);
    build.writeUInt32LE(1, 8);
    build.writeUInt32LE(minos, 12);
    commands.push(build);
    for (const dylib of dylibs) {
        const size = Math.ceil((24 + dylib.length + 1) / 8) * 8;
        const command = Buffer.alloc(size);
        command.writeUInt32LE(0xc, 0);
        command.writeUInt32LE(size, 4);
        command.writeUInt32LE(24, 8);
        command.write(dylib, 24, 'utf8');
        commands.push(command);
    }
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(cpu, 4);
    header.writeUInt32LE(commands.length, 16);
    return Buffer.concat([header, ...commands]);
};

describe('compareVersions', () => {
    test('compares dotted versions numerically', () => {
        expect(compareVersions('2.28', '2.34')).toBeLessThan(0);
        expect(compareVersions('2.2.5', '2.17')).toBeLessThan(0);
        expect(compareVersions('2.28', '2.28.0')).toEqual(0);
        expect(compareVersions('11.0', '10.15')).toBeGreaterThan(0);
    });
});

describe('the ELF parser', () => {
    test('reads the libraries and the symbol versions a binary needs', () => {
        const info = parseElf(syntheticElf());

        expect(info.arch).toEqual('x64');
        expect(info.interpreter).toBeNull();
        expect(info.needed).toEqual(['libc.so.6']);
        expect(info.versions).toEqual([
            {file: 'libc.so.6', name: 'GLIBC_2.17'},
            {file: 'libc.so.6', name: 'GLIBC_2.34'},
        ]);
    });

    test('rejects what is not a little-endian ELF64', () => {
        expect(() => parseElf(Buffer.alloc(80))).toThrow('Not an ELF file');
    });
});

describe('the PE parser', () => {
    test('lists the imported DLLs, lower-cased and sorted', () => {
        const info = parsePe(syntheticPe(0xaa64, ['KERNEL32.dll', 'VCRUNTIME140.dll']));

        expect(info).toEqual({arch: 'arm64', imports: ['kernel32.dll', 'vcruntime140.dll']});
    });

    test('rejects what is not a PE file', () => {
        expect(() => parsePe(Buffer.alloc(128))).toThrow('Not a PE file');
    });
});

describe('the Mach-O parser', () => {
    test('reads the architecture, the dylibs and the deployment target', () => {
        const info = parseMacho(syntheticMacho(0x0100000c, (11 << 16) | (0 << 8), ['/usr/lib/libSystem.B.dylib']));

        expect(info).toEqual({arch: 'arm64', dylibs: ['/usr/lib/libSystem.B.dylib'], minos: '11.0'});
    });

    test('rejects what is not a thin 64-bit Mach-O', () => {
        expect(() => parseMacho(Buffer.alloc(64))).toThrow('thin little-endian 64-bit Mach-O');
    });
});

describe('inspectBinary', () => {
    test('recognizes the three formats by their magic number', () => {
        expect(inspectBinary(syntheticElf()).format).toEqual('elf');
        expect(inspectBinary(syntheticPe(0x8664, ['kernel32.dll'])).format).toEqual('pe');
        expect(inspectBinary(syntheticMacho(0x01000007, 12 << 16, [])).format).toEqual('macho');
        expect(() => inspectBinary(Buffer.from('plain text'))).toThrow('Not an ELF, PE or thin Mach-O');
    });

    test('reads the executable this test runs on', () => {
        const info = inspectBinary(readFileSync(process.execPath));
        const format = {win32: 'pe', darwin: 'macho', linux: 'elf'}[process.platform as 'win32' | 'darwin' | 'linux'];

        expect(info.format).toEqual(format);
        expect(info.arch).toEqual(process.arch);

        if (info.format === 'elf' && process.report?.getReport().header.glibcVersionRuntime) {
            expect(info.needed).toContain('libc.so.6');
            expect(info.versions.some((item: {name: string}) => item.name.startsWith('GLIBC_'))).toBe(true);
        }
    });
});

describe('evaluatePortability', () => {
    const gnu = {format: 'elf', arch: 'x64', interpreter: '/lib64/ld-linux-x86-64.so.2',
        needed: ['libc.so.6', 'libgcc_s.so.1'], versions: [{file: 'libc.so.6', name: 'GLIBC_2.17'}]};
    const policy = {expect: 'gnu', arch: 'x64', maxGlibc: '2.28', maxMacos: '11.0'};

    test('accepts a gnu binary within the glibc floor', () => {
        expect(evaluatePortability(gnu, policy)).toEqual([]);
    });

    test('rejects newer glibc symbols, foreign libraries and libstdc++', () => {
        const problems = evaluatePortability({
            ...gnu,
            needed: [...gnu.needed, 'libstdc++.so.6'],
            versions: [
                {file: 'libc.so.6', name: 'GLIBC_2.34'}, {file: 'libstdc++.so.6', name: 'GLIBCXX_3.4.29'},
            ],
        }, policy);

        expect(problems).toEqual([
            'needs libstdc++.so.6, which not every glibc system provides',
            'needs GLIBC_2.34; the floor is GLIBC_2.28',
            'needs GLIBCXX_3.4.29 from libstdc++.so.6: the binary must not depend on libstdc++',
        ]);
    });

    test('rejects a wrong architecture and a wrong container format', () => {
        expect(evaluatePortability({...gnu, arch: 'arm64'}, policy)).toEqual(['built for arm64, expected x64']);
        expect(evaluatePortability({format: 'pe', arch: 'x64', imports: []}, policy))
            .toEqual(['expected elf format for gnu, found pe']);
    });

    test('requires a musl binary to be static', () => {
        const musl = {...policy, expect: 'musl'};

        expect(evaluatePortability({format: 'elf', arch: 'x64', interpreter: null, needed: [], versions: []}, musl))
            .toEqual([]);
        expect(evaluatePortability(gnu, musl)).toHaveLength(2);
    });

    test('rejects a Windows binary that imports the C runtime dynamically', () => {
        const windows = {...policy, expect: 'windows'};
        const imports = ['kernel32.dll', 'vcruntime140.dll', 'api-ms-win-crt-heap-l1-1-0.dll'];
        const info = {format: 'pe', arch: 'x64', imports};

        expect(evaluatePortability({...info, imports: ['kernel32.dll', 'bcrypt.dll']}, windows)).toEqual([]);
        expect(evaluatePortability(info, windows)).toHaveLength(2);
    });

    test('rejects a macOS binary that links a package manager library or needs a newer system', () => {
        const macos = {...policy, expect: 'macos'};
        const info = {format: 'macho', arch: 'x64', dylibs: ['/usr/lib/libSystem.B.dylib'], minos: '11.0'};

        expect(evaluatePortability(info, macos)).toEqual([]);
        expect(evaluatePortability({...info, dylibs: ['/opt/homebrew/lib/libz.dylib'], minos: '15.0'}, macos))
            .toEqual([
                'links /opt/homebrew/lib/libz.dylib, which is not part of macOS',
                'requires macOS 15.0; the floor is 11.0',
            ]);
        expect(evaluatePortability({...info, minos: null}, macos)).toEqual(['declares no minimum macOS version']);
    });
});

describe('the portability command', () => {
    test('rejects missing and malformed arguments', () => {
        expect(() => checkPortability([])).toThrow('Usage');
        expect(() => checkPortability(['--expect', 'gnu', '--arch', 'x64'])).toThrow('Usage');
        expect(() => checkPortability(['--expect', 'bsd', '--arch', 'x64', 'file'])).toThrow('Usage');
        expect(() => checkPortability(['--arch'])).toThrow('Usage');
    });
});
