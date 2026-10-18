/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
/** Classifies a gate file hash against the frozen baseline and its registered amendment. */
export const gateContractStatus = (file, expected, actual, amendment) => {
    if (actual === expected) return {file, amended: false};
    if (amendment && actual === amendment) return {file, amended: true};
    return {file, error: amendment ? 'Amendment hash mismatch: ' + file : 'Gate contract changed without amendment: ' + file};
};
import {hashGateManifest} from './hashGate.mjs';

// True iff the two gate-manifest arrays match by entry and every gate change is a tightening.
const onlyTightensBounds = (before, after) => {
    if (before.length !== after.length) return false;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const byId = new Map(before.map(entry => [entry.id, entry]));
    return after.every(entry => {
        const past = byId.get(entry.id);
        if (!past) return false;
        if (!same(past.scenario, entry.scenario) || !same(past.args ?? [], entry.args ?? [])
            || !same(past.nodeArgs ?? [], entry.nodeArgs ?? []) || !same(past.requires ?? [], entry.requires ?? [])) return false;
        if (past.gates.length !== entry.gates.length) return false;
        return entry.gates.every((gate, index) => {
            const was = past.gates[index];
            if (gate.metric !== was.metric) return false;
            if (gate.equals !== undefined || was.equals !== undefined) return same(was.equals, gate.equals);
            if (gate.over !== undefined || was.over !== undefined)
                return gate.over === was.over && gate.max <= was.max;
            if (gate.scale !== undefined || was.scale !== undefined)
                return same(gate.scale, was.scale) && gate.max <= was.max;
            if (gate.max !== undefined || was.max !== undefined) return gate.max <= was.max;
            if (gate.min !== undefined || was.min !== undefined) return gate.min >= was.min;
            return false;
        });
    });
};
/** One decision for every consumer (check.mjs, bench:ci run/compare): ok, amended, tightened or an error. */
export const classifyGateChange = ({file, registered, expectedHash, actualHash, amendmentHash, baselineManifest, manifest}) => {
    if (!registered)
        return {file, error: `unregistered gate file: ${file} — register it: node perf/ci/contract/registerGate.mjs perf/gates/${file}`};
    if (actualHash === expectedHash) return {file, amended: false};
    if (amendmentHash && actualHash === amendmentHash) return {file, amended: true};
    if (Array.isArray(baselineManifest) && onlyTightensBounds(baselineManifest, manifest)) return {file, tightened: true};
    if (amendmentHash) return {file, error: `Amendment hash mismatch: ${file}`};
    return {file, error: `Gate contract changed without amendment: ${file}`};
};
/** The bench:ci decision for one baseline gate file — run.mjs and compare.mjs share this exact call. */
export const classifyBaselineGate = ({file, expectedHash, baselineManifest, manifest, amendmentHash}) =>
    classifyGateChange({file, registered: true, expectedHash, actualHash: hashGateManifest(manifest), amendmentHash, baselineManifest, manifest});
