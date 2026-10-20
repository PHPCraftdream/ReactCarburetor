/* oxlint-disable carburetor/max-line-length, carburetor/require-tsdoc */
// Segmented-run selector + task-tier runner.
// Contract (stable, consumed by workflow/npm scripts):
//   node scripts/affected.mjs [--base <ref>] [--files a,b,c] [--json]
//   node scripts/affected.mjs --task [--base <ref>] [--files a,b,c] [--typecheck] [--native] [--dry]
// Without --files: `git diff --name-only <base>...HEAD` + `git diff --name-only HEAD`
// + untracked (`git ls-files --others --exclude-standard`). --base defaults to
// origin/master, falling back to HEAD~1 if that ref is missing.
// Exports select(files, map) -> {full, docsOnly, native, react18, rstest, perfAreas, examples, reasons}.
// rstest: paths for `rstest run <paths>`. perfAreas: substrings passed to
// `node perf/run.mjs --only <area>` (matched against entry id or area).
// Any file not covered by a rule => full=true with reason `unmapped: <file>`.
// With --task: runs the selected checks locally one by one (task tier);
// a full tier always defers to CI (exit 2, nothing heavy runs locally).
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, join, relative, resolve, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');
const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, '..');

export function loadMap() {
    return JSON.parse(readFileSync(join(root, 'affected.map.json'), 'utf8'));
}

// Reverse import graph over __tests__: imported path -> set of test files (transitively) importing it.
// Cached per map object so select stays pure (the map is never mutated).
const graphCache = new WeakMap();
function testDependentsOf(target, map) {
    let reverse = graphCache.get(map);
    if (!reverse) {
        reverse = new Map();
        const edge = (importer, imported) => {
            if (!reverse.has(imported)) reverse.set(imported, new Set());
            reverse.get(imported).add(importer);
        };
        const walk = (dir) => {
            for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
                const path = join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === 'node_modules') continue;
                    walk(path);
                } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
                    const importer = norm(relative(repo, path));
                    for (const match of readFileSync(path, 'utf8').matchAll(/\b(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
                        const base = resolve(dirname(path), match[1]);
                        for (const candidate of [base, base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')]) {
                            if (existsSync(candidate) && statSync(candidate).isFile()) {
                                edge(importer, norm(relative(repo, candidate)));
                                break;
                            }
                        }
                    }
                }
            }
        };
        walk(join(repo, '__tests__'));
        // Expand direct edges to transitive importers.
        const direct = reverse;
        const transitive = new Map();
        const collect = (file, seen) => {
            for (const importer of direct.get(file) || []) {
                if (seen.has(importer)) continue;
                seen.add(importer);
                collect(importer, seen);
            }
        };
        for (const imported of direct.keys()) {
            const seen = new Set();
            collect(imported, seen);
            transitive.set(imported, seen);
        }
        graphCache.set(map, transitive);
        reverse = transitive;
    }
    return reverse.get(target) || new Set();
}

const isTestFixture = (file) => /(?:^|\/)(?:__fixtures__|fixtures)\//.test(file);

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
    const out = {full: false, docsOnly: false, native: false, react18: false, rstest: [], perfAreas: [], examples: false, reasons: []};
    if (files.length === 0) {
        out.reasons.push('no changed files');
        return out;
    }
    const push = (arr, v) => { if (!arr.includes(v)) arr.push(v); };
    let allDocs = true;
    let familyGraph = null;
    const reverseFamilies = (area) => {
        if (familyGraph === null) {
            familyGraph = new Map();
            const scenarioRoot = resolve(repo, map.perfScenarios);
            const walk = (dir) => {
                if (!existsSync(dir)) return;
                for (const entry of readdirSync(dir, {withFileTypes: true})) {
                    const path = join(dir, entry.name);
                    if (entry.isDirectory()) walk(path);
                    else if (entry.isFile() && entry.name.endsWith('.mjs')) {
                        const sourcePath = norm(path.slice(scenarioRoot.length + 1));
                        const sourceFamily = sourcePath.split('/')[0];
                        const text = readFileSync(path, 'utf8');
                        const imports = [...text.matchAll(/\b(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)];
                        for (const match of imports) {
                            const targetPath = norm(relative(scenarioRoot, resolve(dirname(path), match[1])));
                            if (isAbsolute(targetPath) || targetPath.startsWith('../')) continue;
                            const targetFamily = targetPath.split('/')[0];
                            if (targetFamily !== sourceFamily) {
                                if (!familyGraph.has(targetFamily)) familyGraph.set(targetFamily, new Set());
                                familyGraph.get(targetFamily).add(sourceFamily);
                            }
                        }
                    }
                }
            };
            walk(scenarioRoot);
        }
        const visited = new Set([area]);
        const queue = [area];
        while (queue.length) {
            for (const dependent of familyGraph.get(queue.shift()) || []) {
                if (visited.has(dependent)) continue;
                visited.add(dependent);
                queue.push(dependent);
            }
        }
        for (const family of visited) push(out.perfAreas, family);
    };
    for (const raw of files) {
        const file = norm(raw);
        const gate = map.perfGates;
        const scenario = map.perfScenarios;
        const exampleCandidate = map.exampleSources?.some((pattern) => specificity(pattern, file) >= 0)
            && !map.exampleExclusions?.some((pattern) => specificity(pattern, file) >= 0)
            && (file === 'README.md' || file.endsWith('.md')
                || file.startsWith('examples/') || file.startsWith('scripts/tools/')
                || file.startsWith('lib/src/Carburetor/') || file.startsWith('lib/src/Interop/'));
        if (exampleCandidate) out.examples = true;
        let rule = null;
        if (gate && file.startsWith(gate + '/') && file.endsWith('.mjs')) {
            push(out.perfAreas, file.slice(gate.length + 1, -4));
            allDocs = false;
            push(out.reasons, 'perf gate file selects its own area');
        } else if (scenario && file.startsWith(scenario + '/')) {
            const area = file.slice(scenario.length + 1).split('/')[0];
            reverseFamilies(area);
            allDocs = false;
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
            if (rule.react18) out.react18 = true;
            if (rule.examples) out.examples = true;
            if (!rule.docsOnly) allDocs = false;
            for (const p of rule.rstest || []) push(out.rstest, p);
            if (rule.self) {
                const isTest = /\.test\.tsx?$/.test(file);
                if (!isTest && /\.(?:ts|tsx)$/.test(file) && !isTestFixture(file)) {
                    if (file === '__tests__/setupTests.ts' || file === '__tests__/reactActEnvironment.ts') {
                        out.full = true;
                        push(out.reasons, 'global test helper selects the full tier');
                    } else {
                        const dependents = [...testDependentsOf(file, map)].filter((f) => /\.test\.tsx?$/.test(f));
                        if (dependents.length) {
                            for (const d of dependents) push(out.rstest, d);
                            push(out.reasons, 'test helper selects ' + dependents.length + ' dependent suites');
                        } else {
                            out.full = true;
                            push(out.reasons, 'test helper with no dependents fails safe to full');
                        }
                    }
                } else push(out.rstest, file);
            }
            for (const a of rule.perfAreas || []) push(out.perfAreas, a);
        }
    }
    if (out.full) {
        out.rstest = [];
        out.perfAreas = [];
        out.native = false;
        out.examples = true;
        out.docsOnly = false;
        out.react18 = true;
    } else {
        out.docsOnly = allDocs && !out.native && out.rstest.length === 0 && out.perfAreas.length === 0;
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

// A rewritten history (force-push) leaves the push's `before` commit missing: fail safe with a full run.
function baseReachable(base) {
    return spawnSync('git', ['cat-file', '-e', base + '^{commit}'], {stdio: 'ignore'}).status === 0;
}

function unreachableBasePlan(base) {
    return {full: true, docsOnly: false, native: false, react18: false, rstest: [], perfAreas: [], examples: true, reasons: ['base unreachable: ' + base]};
}

function defaultBase() {
    try {
        git(['rev-parse', '--verify', '--quiet', 'origin/master']);
        return 'origin/master';
    } catch {
        return 'HEAD~1';
    }
}

// ---- task tier (check:task) ----

const FULL_MSG = 'full tier required: gh workflow run ci.yml (see docs/testing-tiers.md)';

function parseTaskArgs(argv) {
    const opts = {base: defaultBase(), files: null, typecheck: false, native: false, dry: false};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--base') opts.base = argv[++i];
        else if (argv[i] === '--files') opts.files = argv[++i];
        else if (argv[i] === '--typecheck') opts.typecheck = true;
        else if (argv[i] === '--native') opts.native = true;
        else if (argv[i] === '--dry') opts.dry = true;
    }
    opts.files = opts.files ? opts.files.split(',').map((s) => s.trim()).filter(Boolean) : null;
    return opts;
}

function printPlan(p) {
    console.log('files: ' + (p.files.length ? p.files.join(', ') : '(none)'));
    console.log(p.full ? 'plan: FULL tier' : p.docsOnly ? 'plan: docs only' : p.native ? 'plan: native' : 'plan: selective');
    if (p.rstest.length) console.log('rstest: ' + p.rstest.join(' '));
    if (p.perfAreas.length) console.log('perf areas: ' + p.perfAreas.join(', '));
    for (const r of p.reasons) console.log('- ' + r);
}

// Test files/dirs referencing the build output with a path separator (dist/ or dist\).
function referencesDist(path) {
    const full = resolve(repo, path);
    if (!existsSync(full)) return false;
    // dist with a separator, or 'dist' as a joined path segment (path.join(..., 'dist', ...)).
    const checkFile = (f) => /(?:dist[/\\]|['"]dist['"],)/.test(readFileSync(f, 'utf8'));
    if (statSync(full).isFile()) return /\.test\.tsx?$/.test(path) && checkFile(full);
    const walk = (dir) => {
        for (const entry of readdirSync(dir, {withFileTypes: true})) {
            const p = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules') continue;
                if (walk(p)) return true;
            } else if (entry.isFile() && /\.test\.tsx?$/.test(entry.name) && checkFile(p)) return true;
        }
        return false;
    };
    return walk(full);
}

function buildCommands(p, opts) {
    const cmds = [['node', 'scripts/checkLayout.mjs']];
    if (p.rstest.length) {
        if (p.rstest.some(referencesDist)) cmds.push(['check-dist-fresh']);
        cmds.push(['node', 'node_modules/@rstest/core/bin/rstest.js', 'run', ...p.rstest]);
    }
    for (const area of p.perfAreas) cmds.push(['node', 'perf/run.mjs', '--only', area, '--runs', '3']);
    if (opts.typecheck) cmds.push(['node', 'node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.json']);
    if (p.native || opts.native) cmds.push(['cargo', 'test']);
    return cmds;
}

// Freshness covers every format the tests read, not just the production ESM tree.
const DIST_FORMATS = [['esm', 'Carburetor/index.mjs'], ['esm-prod', 'Carburetor/index.mjs'], ['cjs', 'Carburetor/index.js']];

export function distFreshState(distRoot = resolve(repo, 'dist'), sourcesRoot = resolve(repo, 'lib', 'src')) {
    let newest = 0;
    const walk = (dir) => {
        for (const entry of readdirSync(dir, {withFileTypes: true})) {
            const p = join(dir, entry.name);
            if (entry.isDirectory()) walk(p);
            else if (entry.isFile()) newest = Math.max(newest, statSync(p).mtimeMs);
        }
    };
    walk(sourcesRoot);
    const rslib = resolve(repo, 'rslib.config.ts');
    if (existsSync(rslib)) newest = Math.max(newest, statSync(rslib).mtimeMs);
    const problems = [];
    for (const [format, marker] of DIST_FORMATS) {
        const path = resolve(distRoot, format, marker);
        if (!existsSync(path)) {problems.push(`dist/${format}: missing (${marker})`); continue;}
        if (statSync(path).mtimeMs < newest) problems.push(`dist/${format}: stale (older than sources)`);
    }
    return {fresh: problems.length === 0, problems};
}

function describe(cmd) {
    return cmd[0] === 'cargo' ? 'cd native && cargo test' : cmd.join(' ');
}

function runCommands(cmds, opts) {
    let n = 0;
    for (const cmd of cmds) {
        const label = describe(cmd);
        if (cmd[1] === 'perf/run.mjs' && !existsSync(resolve(repo, 'dist', 'esm-prod', 'Carburetor', 'index.mjs'))) {
            console.log('skip: run npm run build to enable perf gates for ' + cmd[3]);
            continue;
        }
        if (cmd[0] === 'check-dist-fresh') {
            if (opts.dry) {
                console.log('would run: verify a fresh dist (npm run build if stale)');
                n++;
                continue;
            }
            n++;
            const state = distFreshState();
            if (!state.fresh) {
                console.log('FAILED: selected tests read dist/ but the build is missing or stale — run npm run build first (' + state.problems.join('; ') + ')');
                console.log('check:task FAILED (' + n + ' command' + (n === 1 ? '' : 's') + ' attempted)');
                return 1;
            }
            console.log('dist is fresh');
            continue;
        }
        if (cmd[0] === 'cargo' && !opts.native) {
            console.log('hint (not run, implied by map): ' + label);
            continue;
        }
        n++;
        if (opts.dry) {
            console.log('would run: ' + label);
            continue;
        }
        const cwd = cmd[0] === 'cargo' ? resolve(repo, 'native') : repo;
        const r = spawnSync(cmd[0], cmd.slice(1), {stdio: 'inherit', cwd, shell: process.platform === 'win32'});
        if (r.status !== 0) {
            console.log('FAILED: ' + label);
            const code = typeof r.status === 'number' ? r.status : 1;
            console.log('check:task FAILED (' + n + ' command' + (n === 1 ? '' : 's') + ' attempted)');
            return code;
        }
    }
    return 0;
}

function runTask(argv) {
    const opts = parseTaskArgs(argv);
    const files = opts.files || collectFiles(opts.base);
    const p = {files, ...select(files, loadMap())};
    printPlan(p);
    if (p.full) {
        console.log(FULL_MSG);
        return opts.dry ? 0 : 2;
    }
    if (p.docsOnly) {
        console.log('docs only: no code checks needed (docs tier covers rendering, nothing to run)');
        return 0;
    }
    const cmds = buildCommands(p, opts);
    const code = runCommands(cmds, opts);
    if (code !== 0) return code;
    console.log('check:task OK (' + cmds.length + ' commands' + (opts.dry ? ', dry' : '') + ')');
    return 0;
}

function main() {
    const argv = process.argv.slice(2);
    if (argv.includes('--task')) {
        process.exitCode = runTask(argv);
        return;
    }
    let base = defaultBase();
    let filesArg = null;
    let json = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--base') base = argv[++i];
        else if (argv[i] === '--files') filesArg = argv[++i];
        else if (argv[i] === '--json') json = true;
    }
    const lost = !filesArg && !baseReachable(base);
    const files = filesArg ? filesArg.split(',').map((s) => s.trim()).filter(Boolean) : lost ? [] : collectFiles(base);
    const result = lost ? unreachableBasePlan(base) : select(files, loadMap());
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
