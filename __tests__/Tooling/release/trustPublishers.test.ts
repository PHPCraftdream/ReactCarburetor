import {readFileSync} from 'node:fs';
import path from 'node:path';
import {trustPlan} from '../../../scripts/tools/release/trust/trustPlan.mjs';
import {trustPublishers} from '../../../scripts/tools/release/trust/trustPublishers.mjs';

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');
const launcher = JSON.parse(read('npm/carburetor-lint/package.json')) as {
    optionalDependencies: Record<string, string>;
};

describe('trusted publisher plan', () => {
    test('covers the library, the launcher and every platform package of the launcher', () => {
        const {packages} = trustPlan(ROOT);
        const expected = [...Object.keys(launcher.optionalDependencies), 'carburetor-lint', 'react-carburetor'];

        expect(packages).toEqual(expected);
        expect(packages).toHaveLength(10);
    });

    test('names the repository, workflow file and environment the release job runs with', () => {
        const plan = trustPlan(ROOT);
        const workflow = read(`.github/workflows/${plan.workflow}`);

        expect(plan.repository).toBe('PHPCraftdream/ReactCarburetor');
        expect(plan.workflow).toBe('release.yml');
        expect(workflow).toMatch(new RegExp(`^ {4}environment: ${plan.environment}$`, 'm'));
    });
});

describe('trustPublishers', () => {
    test('rejects unknown arguments', () => {
        expect(() => trustPublishers(['--apply'])).toThrow('Usage');
        expect(() => trustPublishers(['--print', '--list'])).toThrow('Usage');
    });

    test('--print shows one npm trust command per package and runs nothing', () => {
        const lines: string[] = [];
        const log = rstest.spyOn(console, 'log').mockImplementation((line: string) => { lines.push(line); });

        try {
            trustPublishers(['--print']);
        } finally {
            log.mockRestore();
        }

        expect(lines).toHaveLength(10);
        expect(lines[9]).toBe(
            'npm trust github react-carburetor --repo PHPCraftdream/ReactCarburetor --file release.yml --env npm --yes',
        );
    });
});
