// Segmented-run selector: maps changed files to required rstest paths and perf areas.
// Contract (stable, consumed by workflow/npm scripts):
//   node scripts/affected.mjs [--base <ref>] [--files a,b,c] [--json]
// Without --files: `git diff --name-only <base>...HEAD` + `git diff --name-only HEAD`
// + untracked (`git ls-files --others --exclude-standard`). --base defaults to
// origin/master, falling back to HEAD~1 if that ref is missing.
// Exports select(files, map) -> {full, docsOnly, native, rstest, perfAreas, reasons}.
// rstest: paths for `rstest run <paths>`. perfAreas: substrings passed to
// `node perf/run.mjs --only <area>` (matched against entry id or area).
// Any file not covered by a rule => full=true with reason `unmapped: <file>`.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');

export function loadMap() {
    return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'affected.map.json'), 'utf8'));
}

function specificity(pattern, path) {
    if (pattern === path) return 100;
    if (!pattern.includes('/')) {
        const suffix = pattern.startsWith('*') ? pattern.slice(1) : null;
        return suffix !== null && path.endsWith(suffix) ? 1 : -1;
    }
    const cut = pattern.indexOf('/**');
    if (cut === -1) return -1;
    const base = pattern.slice(0, cut);
    return path === base || path.startsWith(base + '/') ? base.split('/').length : -1;
}

export function select(files, map) {
    const out = {full: false, docsOnly: false, native: false, rstest: [], perfAreas: [], reasons: []};
    if (files.length === 0) {
        out.reasons.push('no changed files');
        return out;
    }
    const push = (arr, v) => { if (!arr.includes(v)) arr.push(v); };
    let allDocs = true;
    for (const raw of files) {
        const file = norm(raw);
        const gate = map.perfGates;
        const scenario = map.perfScenarios;
        let rule = null;
        if (gate && file.startsWith(gate + '/') && file.endsWith('.mjs')) {
            push(out.perfAreas, file.slice(gate.length + 1, -4));
            push(out.reasons, 'perf gate file selects its own area');
        } else if (scenario && file.startsWith(scenario + '/')) {
            push(out.perfAreas, file.slice(scenario.length + 1).split('/')[0]);
            push(out.reasons, 'perf scenario selects its area');
        } else {
            let best = -1;
            map.rules.forEach((candidate) => {
                const s = specificity(candidate.match, file);
                if (s >= 0 && s >= best) { best = s; rule = candidate; }
            });
            if (!rule) {
                out.full = true;
                push(out.reasons, 'unmapped: ' + file);
                allDocs = false;
                continue;
            }
            push(out.reasons, rule.reason);
            if (rule.full) out.full = true;
            if (rule.native) out.native = true;
            if (!rule.docsOnly) allDocs = false;
            for (const p of rule.rstest || []) push(out.rstest, p);
            if (rule.self) push(out.rstest, file);
            for (const a of rule.perfAreas || []) push(out.perfAreas, a);
        }
    }
    if (out.full) {
        out.rstest = [];
        out.perfAreas = [];
        out.native = false;
        out.docsOnly = false;
    } else {
        out.docsOnly = allDocs && !out.native && out.rstest.length === 0;
    }
    return out;
}

function git(args) {
    return execFileSync('git', args, {encoding: 'utf8'});
}

function collectFiles(base) {
    const list = (args) => git(args).split('\n').map((s) => s.trim()).filter(Boolean);
    const files = list(['diff', '--name-only', base + '...HEAD']);
    files.push(...list(['diff', '--name-only', 'HEAD']));
    files.push(...list(['ls-files', '--others', '--exclude-standard']));
    return [...new Set(files.map(norm))];
}

function defaultBase() {
    try {
        git(['rev-parse', '--verify', '--quiet', 'origin/master']);
        return 'origin/master';
    } catch {
        return 'HEAD~1';
    }
}

function main() {
    const argv = process.argv.slice(2);
    let base = defaultBase();
    let filesArg = null;
    let json = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--base') base = argv[++i];
        else if (argv[i] === '--files') filesArg = argv[++i];
        else if (argv[i] === '--json') json = true;
    }
    const files = filesArg ? filesArg.split(',').map((s) => s.trim()).filter(Boolean) : collectFiles(base);
    const result = select(files, loadMap());
    if (json) {
        console.log(JSON.stringify({base, files, ...result}, null, 2));
        return;
    }
    console.log('base: ' + base);
    console.log('files: ' + (files.length ? files.join(', ') : '(none)'));
    console.log(result.full ? 'plan: FULL run' : result.native ? 'plan: native build only' : result.docsOnly ? 'plan: docs only' : 'plan: selective');
    if (result.rstest.length) console.log('rstest run ' + result.rstest.join(' '));
    if (result.perfAreas.length) console.log('node perf/run.mjs ' + result.perfAreas.map((a) => '--only ' + a).join(' '));
    for (const r of result.reasons) console.log('- ' + r);
}

if (norm(process.argv[1] || '').endsWith('scripts/affected.mjs')) main();
