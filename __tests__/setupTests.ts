import '@testing-library/jest-dom';
import {rstest} from '@rstest/core';

// Console guard (R2-14) — the suite's contract for stderr noise:
//
//   Unexpected console.error/console.warn output FAILS the test that produced
//   it. Diagnostics logged by Carburetor's Diagnostics report and by React
//   itself both route through these channels, so a green run must not sit on
//   top of swallowed mistakes.
//
//   A test that INTENTIONALLY causes output is the scoped exception: it
//   captures console itself (saving the property, or spying on it), asserts on
//   what it captured, and restores. That capture replaces the recorded console
//   for the duration of the test, so the guard sees nothing while the
//   replacement is in place.
//
//   There is deliberately no opt-out or allowance API. A test that needs an
//   allowance it cannot capture has a production bug, not a test problem.

interface TConsoleCall {
    args: unknown[];
    method: string;
}

const recordedCalls: TConsoleCall[] = [];

const installRecorder = (method: 'error' | 'warn'): void => {
    rstest.spyOn(console, method).mockImplementation((...args: unknown[]): void => {
        recordedCalls.push({args, method});
    });
};

// Installed once for the whole run: tests that capture console themselves
// override the spies and restore them afterwards, so per-test reset of the
// recording — not re-installation — keeps tests isolated.
installRecorder('error');
installRecorder('warn');

beforeEach(() => {
    recordedCalls.length = 0;
});

afterEach(() => {
    if (recordedCalls.length === 0) {
        return;
    }

    const lines = recordedCalls.map((call: TConsoleCall, index: number): string => {
        const preview = call.args.map((arg: unknown): string => String(arg)).join(' ');

        return `  #${index + 1} console.${call.method}: ${preview}`;
    });

    // The test's own failure is reported by the runner as its own failure;
    // this throw is a second one, so a broken test and its noise stack instead
    // of masking each other.
    throw new Error(
        `Unexpected console output in this test (${recordedCalls.length} call(s)). ` +
        'If the output is intentional, capture console inside the test and assert on it:\n' +
        lines.join('\n')
    );
});
