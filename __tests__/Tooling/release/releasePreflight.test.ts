import {readFileSync} from 'node:fs';
import path from 'node:path';
import {runInNewContext} from 'node:vm';

interface IPreflightOptions {
    dryRun?: string;
    changelog: string;
    mismatch?: boolean;
}

const read = (file: string): string => readFileSync(path.join(process.cwd(), file), 'utf8');
const version = (JSON.parse(read('package.json')) as {version: string}).version;
const workflow = read('.github/workflows/release.yml');
const section = workflow.split('id: versions')[1].split('\n  audit:')[0];
const script = section.split("node -e '\n")[1].split("\n          '")[0];

const checkPreflight = ({dryRun, changelog, mismatch}: IPreflightOptions): string => {
    let output = '';
    const fs = {
        readFileSync(file: string): string {
            if (file === 'CHANGELOG.md') return changelog;
            const text = read(file);
            if (mismatch && file === 'npm/lint/package.json') {
                return JSON.stringify({...JSON.parse(text), version: '0.0.0'});
            }
            return text;
        },
        appendFileSync(_file: string, value: string): void { output += value; },
    };
    runInNewContext(script, {
        require: (name: string): typeof fs => {
            if (name !== 'fs') throw new Error(`Unexpected module: ${name}`);
            return fs;
        },
        process: {
            env: {DRY_RUN: dryRun, GITHUB_OUTPUT: 'output'},
            exit(code: number): never { throw new Error(`Release preflight exited with ${code}`); },
        },
        console: {log(): void {}, error(): void {}},
    });
    return output;
};

describe('release changelog preflight', () => {
    test('the workflow passes the dry_run input to the changelog check', () => {
        expect(section).toContain('DRY_RUN: ${{ inputs.dry_run }}');
    });

    test('dry run accepts Unreleased without inventing a release date', () => {
        expect(checkPreflight({dryRun: 'true', changelog: '## [Unreleased]\n'}))
            .toContain(`version=${version}\n`);
    });

    test.each(['false', undefined, 'TRUE'])('Unreleased cannot authorize publishing with DRY_RUN=%s', dryRun => {
        expect(() => checkPreflight({dryRun, changelog: '## [Unreleased]\n'}))
            .toThrow('Release preflight exited with 1');
    });

    test.each(['true', 'false'])('a dated version section is accepted with DRY_RUN=%s', dryRun => {
        expect(checkPreflight({dryRun, changelog: `## [${version}] - 2026-10-26\n`}))
            .toContain(`version=${version}\n`);
    });

    test.each(['', 'Unreleased\n', '## [0.0.0] - 2026-10-26\n'])(
        'dry run rejects a missing section: %s', changelog => {
            expect(() => checkPreflight({dryRun: 'true', changelog}))
                .toThrow('Release preflight exited with 1');
        });

    test('dry run still rejects mismatched package versions', () => {
        expect(() => checkPreflight({dryRun: 'true', changelog: '## [Unreleased]\n', mismatch: true}))
            .toThrow('Release preflight exited with 1');
    });
});
