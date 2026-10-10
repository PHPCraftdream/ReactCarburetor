import {mkdtempSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join, basename, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {emit, load, distRoot} from '../../harness/lib.mjs';

const api = await load();
const declarationRoots = [distRoot];
if (basename(distRoot) === 'esm-prod') declarationRoots.push(resolve(dirname(distRoot), 'esm'));
if (basename(distRoot) === 'cjs-prod') declarationRoots.push(resolve(dirname(distRoot), 'cjs'));
const declaration = declarationRoots.flatMap(root => ['index.d.mts', 'index.d.ts']
    .map(name => resolve(root, 'Carburetor', name))).find(path => existsSync(path));
if (!declaration) throw new Error(`Missing built public declarations for ${distRoot}`);
const entry = declaration.replace(/\.d\.mts$/, '.mjs').replace(/\.d\.ts$/, '.js').replaceAll('\\', '/');
const temporary = mkdtempSync(join(tmpdir(), 'computed41-'));
let strictConsumer = false;
try {
    const source = join(temporary, 'consumer.mts');
    writeFileSync(source, `import {Computed, Carburetor} from ${JSON.stringify(entry)};
class Named extends Computed<number> {
    public uid = 'total';
}
const store = new Carburetor({n: 1});
const result: number = new Named(read => read(store).n).get();
void result;
`);
    const child = spawnSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'),
        '--ignoreConfig', '--strict', '--noEmit', '--skipLibCheck', '--target', 'ES2020', '--module', 'NodeNext',
        '--moduleResolution', 'NodeNext', source], {encoding: 'utf8'});
    if (child.error || child.status !== 0) throw new Error(child.error?.message ?? child.stdout + child.stderr);
    strictConsumer = true;
} finally {
    rmSync(temporary, {recursive: true, force: true});
}
const a = new api.Carburetor({n: 1});
const b = new api.Carburetor({n: 2});
/** Exercises domain identity collisions through the built public Computed API. */
class Named extends api.Computed {
    /** Shared application id must not merge distinct computed dependency edges. */
    uid = 'total';
}
const first = new Named(read => read(a).n);
const second = new Named(read => read(b).n);
const sum = api.computed(read => read(first) + read(second));
let deliveries = 0;
const id = sum.subscribe(() => { deliveries++; });
const initial = sum.get();
b.update(draft => { draft.n = 3; });
const final = sum.get();
sum.unsubscribe(id);
// Keep the frozen negative at final/deliveries, not a protected/private declaration conflict.
// Only a correct uid-only graph advances to the broader built-declaration subclass contract.
let strictDomainConsumer = false;
if (initial === 3 && final === 4 && deliveries === 1) {
    const directory = mkdtempSync(join(tmpdir(), 'computed41-domain-'));
    try {
        const source = join(directory, 'consumer.mts');
        writeFileSync(source, `import {Computed} from ${JSON.stringify(entry)};
class Domain extends Computed<number> {
    public uid = 'total';
    public version = 'domain';
    public value = 'domain';
    public valid = false;
    public dependencies = 'domain';
    public versions = 'domain';
    public announced = 'domain';
    public body = 'domain';
    public options = 'domain';
    public onDependencyChanged = () => { throw new Error('domain callback'); };
    public markStale = this.onDependencyChanged;
    public settle = this.onDependencyChanged;
    public recompute = this.onDependencyChanged;
    public deliver = this.onDependencyChanged;
}
const result: number = new Domain(() => 4).get();
void result;
`);
        const child = spawnSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'),
            '--ignoreConfig', '--strict', '--noEmit', '--skipLibCheck', '--target', 'ES2020', '--module', 'NodeNext',
            '--moduleResolution', 'NodeNext', source], {encoding: 'utf8'});
        if (child.error || child.status !== 0) throw new Error(child.error?.message ?? child.stdout + child.stderr);
        strictDomainConsumer = true;
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
}
emit({initial, final, deliveries, strictConsumer, strictDomainConsumer, done: true});
