import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {execFileSync} from 'child_process';

const args = process.argv.slice(2);
const name = args[0];
const options = args.slice(1);
const apply = options.includes('--apply');
const allowDirty = options.includes('--allow-dirty');

if (args.length < 1 || options.length > 2 || new Set(options).size !== options.length
    || options.some(option => option !== '--apply' && option !== '--allow-dirty')
    || (allowDirty && !apply)
    || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error('Usage: node scripts/removeSafeWorktree.mjs <name> [--apply --allow-dirty]');
}

const samePath = (a, b) => {
    const left = path.resolve(a);
    const right = path.resolve(b);

    return process.platform === 'win32'
        ? left.toLowerCase() === right.toLowerCase()
        : left === right;
};

const within = (candidate, parent) => {
    const relative = path.relative(parent, candidate);

    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative));
};

const checkoutRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commonGit = execFileSync('git', ['-C', checkoutRoot, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
}).trim();
const commonGitDir = path.resolve(checkoutRoot, commonGit);

if (path.basename(commonGitDir) !== '.git' || !fs.statSync(commonGitDir).isDirectory()) {
    throw new Error('Expected a regular repository with a common .git directory.');
}

const repoRoot = path.dirname(commonGitDir);
const worktreesRoot = path.join(repoRoot, 'worktrees');
const worktree = path.resolve(worktreesRoot, name);
const localModules = path.join(worktree, 'node_modules');
const sharedModules = path.join(repoRoot, 'node_modules');

if (!samePath(path.dirname(worktree), worktreesRoot) || !fs.lstatSync(worktree).isDirectory()) {
    throw new Error('Worktree must be a direct, regular child of worktrees.');
}

if (fs.lstatSync(worktree).isSymbolicLink()) {
    throw new Error('The worktree itself is a link.');
}

const records = execFileSync('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
}).trim().split(/\r?\n\r?\n/);
const record = records.find(block => block.split(/\r?\n/).some(line => line.startsWith('worktree ')
    && samePath(line.slice('worktree '.length), worktree)));

if (!record || !record.split(/\r?\n/).includes('detached')) {
    throw new Error('Directory must be a registered detached worktree of this repository.');
}

const status = execFileSync('git', ['-C', worktree, 'status', '--porcelain'], {
    encoding: 'utf8',
}).trim();
const sharedModulesReal = fs.existsSync(sharedModules) ? fs.realpathSync.native(sharedModules) : null;

const scanLinks = () => {
    const pending = [worktree];
    const links = [];

    while (pending.length > 0) {
        const directory = pending.pop();

        for (const entry of fs.readdirSync(directory)) {
            const fullPath = path.join(directory, entry);
            const stat = fs.lstatSync(fullPath);

            if (stat.isSymbolicLink()) {
                const target = fs.realpathSync.native(fullPath);

                if (!sharedModulesReal || !within(fullPath, localModules)
                    || !within(target, sharedModulesReal)
                    || !fs.statSync(fullPath).isDirectory()) {
                    throw new Error(`Unexpected link or target: ${fullPath}`);
                }

                links.push({fullPath, target});
            } else if (stat.isDirectory()) {
                pending.push(fullPath);
            }
        }
    }

    return links;
};

const links = scanLinks();

if (!apply) {
    console.log(`Dry run OK: ${worktree}`);
    if (status) {
        console.log('Worktree has uncommitted files; removal requires --allow-dirty.');
    }
    for (const link of links) {
        console.log(`Would unlink: ${link.fullPath} -> ${link.target}`);
    }
    console.log('Would remove the registered worktree. Pass --apply to do it.');
} else {
    if (status && !allowDirty) {
        throw new Error('Worktree has uncommitted files; pass --allow-dirty only after integration.');
    }

    for (const {fullPath, target} of links) {
        if (process.platform === 'win32') {
            fs.rmdirSync(fullPath);
        } else {
            fs.unlinkSync(fullPath);
        }

        if (fs.existsSync(fullPath) || !fs.existsSync(target)) {
            throw new Error(`Link removal did not leave its target intact: ${fullPath}`);
        }
    }

    if (scanLinks().length !== 0) {
        throw new Error('A link appeared after cleanup; refusing recursive worktree removal.');
    }

    execFileSync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', worktree], {
        stdio: 'inherit',
    });

    if (fs.existsSync(worktree)) {
        throw new Error(`Git did not remove the worktree: ${worktree}`);
    }

    console.log(`Removed worktree: ${worktree}`);
}
