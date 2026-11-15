import {describe, expect, test} from "@rstest/core";
import {nativeOutput} from "@plugin/Utils/nativeOutput.mts";

const BINARY = '/opt/carburetor-lint';
const finding = {file: 'a.tsx', line: 1, column: 1, rule: 'no-get-data-in-render', message: 'm', severity: 'error'};

describe('nativeOutput', () => {
    test('exit 0 with no output is a clean run', () => {
        expect(nativeOutput(BINARY, {status: 0, stdout: '', stderr: ''})).toEqual([]);
    });

    test('exit 1 carries the findings the binary printed', () => {
        expect(nativeOutput(BINARY, {status: 1, stdout: JSON.stringify([finding]), stderr: ''})).toEqual([finding]);
    });

    test('exit 2 is the binary\'s own failure and names its stderr', () => {
        expect(() => nativeOutput(BINARY, {status: 2, stdout: '', stderr: 'bad config'}))
            .toThrow(/the native binary failed \(exit code 2\): bad config/);
    });

    // The release profile aborts on panic: no JSON, and neither 0, 1 nor 2 as the status.
    test('a crash by signal is a failure, never an empty clean result', () => {
        expect(() => nativeOutput(BINARY, {status: null, signal: 'SIGABRT', stdout: '', stderr: 'panicked'}))
            .toThrow(/the native binary failed \(terminated by SIGABRT\): panicked/);
    });

    test('a foreign exit status is a failure, never an empty clean result', () => {
        expect(() => nativeOutput(BINARY, {status: 3221226505, stdout: '', stderr: ''}))
            .toThrow(/the native binary failed \(exit code 3221226505\)/);
    });

    test('a launch failure names the binary', () => {
        expect(() => nativeOutput(BINARY, {status: null, stdout: '', stderr: '', error: {message: 'ENOENT'}}))
            .toThrow(/could not run the native binary at \/opt\/carburetor-lint: ENOENT/);
    });
});
