import {run} from './matrix.mjs';

/**
 * Two module formats of the *installed, packed* library sharing one process — the real-world
 * shape of the dual-package hazard, and what the sharedSingleton dev diagnostic exists to
 * catch. Runs against `<installDir>/node_modules/react-carburetor`, not the repo's
 * own `dist/`, so this proves the shipped tarball, not just the local build.
 */
const SCRIPT = `
const path = require('path');
const pkgRoot = path.join(process.cwd(), 'node_modules', 'react-carburetor');
const toFileUrl = (file) => 'file:///' + path.resolve(file).split(path.sep).join('/');

const messages = [];
console.error = (...args) => messages.push(args.join(' '));

(async () => {
    require(path.join(pkgRoot, 'dist', 'cjs', 'Carburetor', 'index.js'));
    await import(toFileUrl(path.join(pkgRoot, 'dist', 'esm', 'Carburetor', 'index.mjs')));

    const cjsCtx = path.join(pkgRoot, 'dist', 'cjs', 'Carburetor', 'Component', 'Scope', 'CarburetorContext.js');
    const esmCtx = path.join(pkgRoot, 'dist', 'esm', 'Carburetor', 'Component', 'Scope', 'CarburetorContext.mjs');

    require(cjsCtx);
    await import(toFileUrl(esmCtx));

    process.stdout.write(JSON.stringify({messages}));
})().catch((error) => {
    process.stderr.write(String((error && error.stack) || error));
    process.exit(1);
});
`;

/** Runs the cross-format probe inside an already-installed cell and checks the report's wording. */
export const runDuplicateCheck = (installDir) => {
    const result = run(process.execPath, ['-e', SCRIPT], {cwd: installDir});

    if (!result.ok) {
        return {ok: false, stderr: result.stdout + result.stderr};
    }

    let parsed;

    try {
        parsed = JSON.parse(result.stdout);
    } catch (error) {
        return {ok: false, stderr: 'could not parse probe output (' + String(error) + '): ' + result.stdout};
    }

    const contextMessage = parsed.messages.find((message) => message.includes('"CarburetorContext"'));

    if (!contextMessage) {
        const seen = JSON.stringify(parsed.messages);

        return {ok: false, stderr: 'no diagnostic fired for CarburetorContext; messages: ' + seen};
    }

    if (!contextMessage.includes('duplicated install')) {
        return {ok: false, stderr: 'diagnostic missing the copy/module-format wording: ' + contextMessage};
    }

    if (contextMessage.includes('React modules')) {
        return {ok: false, stderr: 'false positive: one real React install reported as two: ' + contextMessage};
    }

    return {ok: true};
};
