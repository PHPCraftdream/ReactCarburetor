/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Registers new gate files in the freeze contract; run from the repository root.
import {readFileSync, writeFileSync} from 'node:fs';
import {basename, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {hashGateManifest} from './hashGate.mjs';

// Same deterministic layout as the committed registry: compact one-line entries per file.
const serialize = doc => {
    const section = name => {
        const files = Object.entries(doc[name].files).map(([file, entry]) =>
            '      "' + file + '": ' + JSON.stringify({hash: entry.hash, manifest: entry.manifest}));
        return '  "' + name + '": {\n    "sha": ' + JSON.stringify(doc[name].sha) + ',\n    "files": {\n' + files.join(',\n') + '\n    }\n  }';
    };
    return ['{', ['baseline', 'frozen', 'registered'].map(section).join(',\n'), '}\n'].join('\n');
};

const registryPath = resolve('perf/ci/contract/gate-baseline.json');
const doc = JSON.parse(readFileSync(registryPath, 'utf8'));
doc.registered ??= {sha: 'unreleased', files: {}};
const args = process.argv.slice(2);
if (!args.length) throw new Error('Usage: node perf/ci/contract/registerGate.mjs perf/gates/<name>.mjs [more files...]');
let registered = 0, refused = 0;
for (const arg of args) {
    const path = resolve(arg);
    const file = basename(path);
    if (!path.startsWith(resolve('perf/gates')) || !file.endsWith('.mjs')) {
        console.error('refused: ' + arg + ' — must be a perf/gates/<name>.mjs file');
        refused++; continue;
    }
    if (Object.hasOwn(doc.baseline.files, file) || Object.hasOwn(doc.frozen.files, file)) {
        console.error('refused: ' + file + ' is frozen at the baseline — record an amendment in gate-amendments.json instead');
        refused++; continue;
    }
    const manifest = (await import(pathToFileURL(path).href)).default;
    if (!Array.isArray(manifest)) {
        console.error('refused: ' + file + ' does not export a gate manifest array');
        refused++; continue;
    }
    const hash = hashGateManifest(manifest);
    if (Object.hasOwn(doc.registered.files, file)) {
        if (doc.registered.files[file].hash === hash) {
            console.log(file + ' already registered (unchanged)');
            continue;
        }
        console.error('refused: ' + file + ' changed since registration — a lowered bound needs no action (the ratchet accepts it), anything else needs an amendment; the registered reference is not rewritten');
        refused++; continue;
    }
    doc.registered.files[file] = {hash, manifest};
    doc.registered.sha = 'unreleased';
    writeFileSync(registryPath, serialize(doc));
    console.log(file + ' registered (' + hash + ')');
    registered++;
}
console.log(registered + ' file' + (registered === 1 ? '' : 's') + ' registered');
process.exitCode = refused ? 1 : 0;
