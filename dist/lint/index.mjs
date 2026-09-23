import { spawnSync } from "child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import * as __rspack_external_path from "path";
import * as __rspack_external_os from "os";
const RECOMMENDED = {
    'carburetor/no-async-effect': 'error',
    'carburetor/no-async-transaction': 'error',
    'carburetor/no-computed-get-in-computed': 'error',
    'carburetor/no-computed-get-in-render': 'error',
    'carburetor/no-direct-data-write': 'warn',
    'carburetor/no-duplicate-effect-name': 'error',
    'carburetor/no-escaping-tracked-data': 'warn',
    'carburetor/no-external-data-mutation': 'error',
    'carburetor/no-get-data-in-render': 'error',
    'carburetor/no-handler-created-in-render': 'warn',
    'carburetor/no-lifecycle-class-property': 'error',
    'carburetor/no-module-level-store': 'off',
    'carburetor/no-store-write-in-render': 'error',
    'carburetor/no-tracked-data-mutation': 'error',
    'carburetor/no-untrackable-draft-mutation': 'warn',
    'carburetor/no-untrackable-store-data': 'warn',
    'carburetor/no-use-carburetor-outside-render': 'error',
    'carburetor/require-bind-for-passed-method': 'error',
    'carburetor/require-effect-deps': 'warn',
    'carburetor/require-emit-after-draft-write': 'error',
    'carburetor/require-method-for-closure': 'warn',
    'carburetor/require-module-function': 'warn',
    "carburetor/require-subscription-disposal": 'warn',
    'carburetor/require-super-in-lifecycle': 'error'
};
const offsetAt = (text, line, column)=>{
    const lines = text.split('\n');
    let offset = 0;
    for(let index = 0; index < line - 1 && index < lines.length; index++)offset += lines[index].length + 1;
    return offset + (column - 1);
};
const platformPackageNames = (platform = process.platform, arch = process.arch)=>{
    if ('linux' === platform) {
        const order = 'musl' === reportLibc() ? [
            'musl',
            'gnu'
        ] : [
            'gnu',
            'musl'
        ];
        return order.map((libc)=>`carburetor-lint-linux-${arch}-${libc}`);
    }
    return [
        `carburetor-lint-${platform}-${arch}`
    ];
};
const reportLibc = ()=>{
    try {
        var _process_report;
        const header = null == (_process_report = process.report) ? void 0 : _process_report.getReport().header;
        return (null == header ? void 0 : header.glibcVersionRuntime) ? 'gnu' : header ? 'musl' : void 0;
    } catch  {
        return;
    }
};
const BINARY_NAME = 'win32' === process.platform ? 'carburetor-lint.exe' : 'carburetor-lint';
const HERE = __rspack_external_path.dirname(fileURLToPath(import.meta.url));
const requireFrom = createRequire(import.meta.url);
const resolveBinary = ()=>{
    const override = process.env.CARBURETOR_LINT_BIN;
    if (override && existsSync(override)) return override;
    const platformPackage = platformPackageBinary();
    if (platformPackage) return platformPackage;
    return workspaceBinary();
};
const workspaceBinary = ()=>{
    let directory = HERE;
    for(;;){
        for (const profile of [
            'release',
            'debug'
        ]){
            const candidate = __rspack_external_path.join(directory, 'native', 'target', profile, BINARY_NAME);
            if (existsSync(candidate)) return candidate;
        }
        const parent = __rspack_external_path.dirname(directory);
        if (parent === directory) return;
        directory = parent;
    }
};
const platformPackageBinary = ()=>{
    for (const name of platformPackageNames())try {
        const binary = requireFrom.resolve(`${name}/${BINARY_NAME}`);
        if (existsSync(binary)) return binary;
    } catch  {}
};
const ALL_RULE_IDS = Object.keys(RECOMMENDED);
const WAIT_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 20;
let cached;
const sleepSync = (milliseconds)=>{
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};
const runPaths = (cwd)=>{
    const digest = Buffer.from(cwd).toString('base64url').slice(0, 24);
    const base = __rspack_external_path.join(__rspack_external_os.tmpdir(), `carburetor-lint-${process.pid}-${digest}`);
    return {
        lock: `${base}.lock`,
        result: `${base}.json`
    };
};
const runBinary = (cwd, resolve = resolveBinary)=>{
    const binary = resolve();
    if (!binary) throw new Error(`react-carburetor/lint: no native binary for this platform. Install it with "npm install --save-dev carburetor-lint" (its optionalDependencies add the package this machine needs, ${platformPackageNames()[0]}), or set CARBURETOR_LINT_BIN to a built binary, or run "cargo build --release" inside native/ in a checkout of this repository.`);
    const args = ALL_RULE_IDS.flatMap((id)=>[
            '--rule',
            `${id}=error`
        ]);
    const result = spawnSync(binary, [
        '--format=json',
        ...args,
        '.'
    ], {
        cwd,
        encoding: 'utf8'
    });
    if (result.error) throw new Error(`react-carburetor/lint: could not run the native binary at ${binary}: ${result.error.message}`);
    if (2 === result.status) throw new Error(`react-carburetor/lint: the native binary failed: ${result.stderr}`);
    return JSON.parse(result.stdout || '[]');
};
const runNativeOnce = (cwd, resolve = resolveBinary)=>{
    if (cached) return cached;
    const { lock, result } = runPaths(cwd);
    mkdirSync(__rspack_external_path.dirname(lock), {
        recursive: true
    });
    let isRunner = false;
    try {
        closeSync(openSync(lock, 'wx'));
        isRunner = true;
    } catch  {
        isRunner = false;
    }
    if (isRunner) try {
        cached = runBinary(cwd, resolve);
        writeFileSync(result, JSON.stringify(cached));
        return cached;
    } catch (error) {
        writeFileSync(result, JSON.stringify({
            error: error instanceof Error ? error.message : String(error)
        }));
        throw error;
    } finally{
        try {
            unlinkSync(lock);
        } catch  {}
    }
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while(!existsSync(result) && Date.now() < deadline)sleepSync(POLL_INTERVAL_MS);
    if (!existsSync(result)) throw new Error(`react-carburetor/lint: another worker ran the native binary but produced no result within ${WAIT_TIMEOUT_MS} ms. Run the binary directly to see why.`);
    const payload = JSON.parse(readFileSync(result, 'utf8'));
    if (!Array.isArray(payload)) throw new Error(`react-carburetor/lint: the worker that ran the native binary failed: ${payload.error}`);
    cached = payload;
    return cached;
};
const nativeRule = (id, description)=>({
        meta: {
            type: 'problem',
            docs: {
                description
            }
        },
        create (context) {
            return {
                'Program:exit' () {
                    const diagnostics = runNativeOnce(process.cwd());
                    const file = __rspack_external_path.relative(process.cwd(), context.filename).replace(/\\/g, '/');
                    const text = context.sourceCode.getText();
                    diagnostics.filter((diagnostic)=>diagnostic.file.replace(/^\.\//, '') === file && diagnostic.rule === id).forEach((diagnostic)=>{
                        const offset = offsetAt(text, diagnostic.line, diagnostic.column);
                        const point = {
                            line: diagnostic.line,
                            column: diagnostic.column - 1
                        };
                        const node = {
                            type: 'Program',
                            start: offset,
                            end: offset,
                            range: [
                                offset,
                                offset
                            ],
                            loc: {
                                start: point,
                                end: point
                            }
                        };
                        context.report({
                            node,
                            message: diagnostic.message
                        });
                    });
                }
            };
        }
    });
const requireMethodForClosure = nativeRule('carburetor/require-method-for-closure', 'Declare a closure that depends on the class as a method, so it is not rebuilt on every call.');
const requireModuleFunction = nativeRule('carburetor/require-module-function', 'Declare code that uses nothing from the class at module level, so it is built once.');
const noAsyncTransaction = nativeRule('carburetor/no-async-transaction', 'Keep a transaction or update body synchronous.');
const noModuleLevelStore = nativeRule('carburetor/no-module-level-store', 'Create stores per request through a scope, not once per module.');
const noUntrackableStoreData = nativeRule('carburetor/no-untrackable-store-data', 'Keep plain objects and arrays in a store; convert at the edges.');
const requireSubscriptionDisposal = nativeRule("carburetor/require-subscription-disposal", "Keep a way to release a subscription, prefer watch(), which returns one.");
const noAsyncEffect = nativeRule('carburetor/no-async-effect', 'Keep an effect body synchronous so its cleanup survives.');
const noDuplicateEffectName = nativeRule('carburetor/no-duplicate-effect-name', 'Give every effect in a component a name of its own.');
const requireEffectDeps = nativeRule('carburetor/require-effect-deps', 'List the props and state an effect reads in its dependency array.');
const noComputedGetInComputed = nativeRule('carburetor/no-computed-get-in-computed', 'Inside a computed, read sources through the reader it is given.');
const noComputedGetInRender = nativeRule('carburetor/no-computed-get-in-render', 'Read a computed in render through useComputed, not through get().');
const noEscapingTrackedData = nativeRule('carburetor/no-escaping-tracked-data', 'Use tracked data inside the render that read it.');
const noGetDataInRender = nativeRule('carburetor/no-get-data-in-render', 'Read state in render through useCarburetor, not through getData().');
const noHandlerCreatedInRender = nativeRule('carburetor/no-handler-created-in-render', 'Pass a stable handler to a child component, bound once with bind.');
const noLifecycleClassProperty = nativeRule('carburetor/no-lifecycle-class-property', 'Declare lifecycle methods as methods, not as class properties.');
const requireBindForPassedMethod = nativeRule('carburetor/require-bind-for-passed-method', 'Bind a component method with bind before passing it as a value.');
const requireSuperInLifecycle = nativeRule('carburetor/require-super-in-lifecycle', 'Call the base implementation when overriding a lifecycle method.');
const noUseCarburetorOutsideRender = nativeRule('carburetor/no-use-carburetor-outside-render', 'Call useCarburetor and useComputed in render only.');
const noDirectDataWrite = nativeRule('carburetor/no-direct-data-write', 'Write through draft, which records the changed paths.');
const noExternalDataMutation = nativeRule('carburetor/no-external-data-mutation', 'Change state through a store method, not through getData().');
const noStoreWriteInRender = nativeRule('carburetor/no-store-write-in-render', 'Do not change a store while rendering.');
const noTrackedDataMutation = nativeRule('carburetor/no-tracked-data-mutation', 'Change state through a carburetor method, not through tracked data.');
const noUntrackableDraftMutation = nativeRule('carburetor/no-untrackable-draft-mutation', 'Replace an untrackable value instead of mutating it through draft.');
const requireEmitAfterDraftWrite = nativeRule('carburetor/require-emit-after-draft-write', 'Publish a draft write, ideally through update(draft => new state).');
const src_plugin = {
    meta: {
        name: 'carburetor'
    },
    rules: {
        'no-async-effect': noAsyncEffect,
        'no-async-transaction': noAsyncTransaction,
        'no-computed-get-in-computed': noComputedGetInComputed,
        'no-computed-get-in-render': noComputedGetInRender,
        'no-direct-data-write': noDirectDataWrite,
        'no-duplicate-effect-name': noDuplicateEffectName,
        'no-escaping-tracked-data': noEscapingTrackedData,
        'no-external-data-mutation': noExternalDataMutation,
        'no-get-data-in-render': noGetDataInRender,
        'no-handler-created-in-render': noHandlerCreatedInRender,
        'no-lifecycle-class-property': noLifecycleClassProperty,
        'no-module-level-store': noModuleLevelStore,
        'no-store-write-in-render': noStoreWriteInRender,
        'no-tracked-data-mutation': noTrackedDataMutation,
        'no-untrackable-draft-mutation': noUntrackableDraftMutation,
        'no-untrackable-store-data': noUntrackableStoreData,
        'no-use-carburetor-outside-render': noUseCarburetorOutsideRender,
        'require-bind-for-passed-method': requireBindForPassedMethod,
        'require-effect-deps': requireEffectDeps,
        'require-emit-after-draft-write': requireEmitAfterDraftWrite,
        'require-method-for-closure': requireMethodForClosure,
        'require-module-function': requireModuleFunction,
        "require-subscription-disposal": requireSubscriptionDisposal,
        'require-super-in-lifecycle': requireSuperInLifecycle
    }
};
src_plugin.configs = {
    recommended: {
        plugins: {
            carburetor: src_plugin
        },
        rules: RECOMMENDED
    }
};
const src = src_plugin;
export default src;
