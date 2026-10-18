// Gate contract freeze check: pure Node, no install, build or git; run from the repository root.
import {readFileSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {classifyGateChange} from './gateContract.mjs';
import {hashGateManifest} from './hashGate.mjs';

const registryPath = resolve('perf/ci/contract/gate-baseline.json');
let doc;
try {
    doc = JSON.parse(readFileSync(registryPath, 'utf8'));
} catch (error) {
    throw new Error('Malformed freeze registry ' + registryPath + ': ' + error.message);
}
for (const [section, value] of Object.entries(doc)) {
    if (typeof value.sha !== 'string' || typeof value.files !== 'object' || value.files === null)
        throw new Error('Corrupt freeze registry: ' + section);
    for (const [file, entry] of Object.entries(value.files))
        if (typeof entry.hash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.hash) || !Array.isArray(entry.manifest))
            throw new Error(`Corrupt freeze registry: ${section}/${file}`);
}
const amendments = JSON.parse(readFileSync(resolve('perf/ci/contract/gate-amendments.json'), 'utf8'));
for (const [file, entry] of Object.entries(amendments))
    if (!entry.sha256 || !entry.reason || !entry.commit) throw new Error('Incomplete amendment entry: ' + file);
const sections = [doc.baseline, doc.frozen, doc.registered];
const manifestOf = async file => {
    const manifest = (await import(pathToFileURL(join(resolve('perf/gates'), file)).href)).default;
    if (!Array.isArray(manifest)) throw new Error('Invalid gate manifest: ' + file);
    return manifest;
};
const entryOf = file => sections.find(section => section && Object.hasOwn(section.files, file))?.files[file];
const errors = [];
let amended = 0, tightened = 0, total = 0;
for (const file of readdirSync(resolve('perf/gates')).filter(name => name.endsWith('.mjs')).sort()) {
    total++;
    let manifest;
    try {
        manifest = await manifestOf(file);
    } catch (error) {
        errors.push(`${file}: cannot be imported: ${error.message}`);
        continue;
    }
    for (const {id, gate} of manifest.flatMap(entry => (entry.gates ?? []).map(gate => ({id: entry.id, gate}))))
        if (gate.min === 0 && typeof gate.metric === 'string' && gate.metric.endsWith('Ms'))
            errors.push(`${file}: ${id} gate ${gate.metric} uses min: 0, which holds for every completed run`);
    const entry = entryOf(file);
    const decision = classifyGateChange({
        file, registered: !!entry, expectedHash: entry?.hash, actualHash: hashGateManifest(manifest),
        amendmentHash: amendments[file]?.sha256, baselineManifest: entry?.manifest, manifest,
    });
    if (decision.error) {errors.push(decision.error); continue;}
    if (decision.amended) {amended++; continue;}
    if (decision.tightened) {tightened++; console.log('tightened ' + file + ': lower bounds without amendment are allowed');}
}
for (const file of Object.keys(amendments)) {
    const manifest = await manifestOf(file);
    if (hashGateManifest(manifest) === entryOf(file)?.hash) console.log('stale amendment: ' + file);
}
console.log(total + ' gate files, ' + amended + ' amended, ' + tightened + ' tightened, ' + errors.length + ' errors');
errors.forEach(error => console.error(error));
process.exitCode = errors.length ? 1 : 0;
