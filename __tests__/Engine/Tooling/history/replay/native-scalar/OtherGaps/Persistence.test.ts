import {rstest} from '@rstest/core';
import {readVersioned} from '@/Carburetor/Tooling/Persist/ReadVersioned';
import {reportRemovalFailure} from '@/Carburetor/Tooling/Persist/ReportRemovalFailure';
import {reportRestoreFailure} from '@/Carburetor/Tooling/Persist/ReportRestoreFailure';
import {IS_DEVELOPMENT} from '@/Carburetor/Store/Utils/DevelopmentFlag';
import {diagnostics} from '@/Carburetor/Store/Diagnostics/DiagnosticsInstance';

describe('readVersioned', () => {
    test('decodes envelopes, migrates forward, and rejects invalid or future versions', () => {
        expect(readVersioned({__carburetorVersion: 1, data: 2}, 2, {2: value => Number(value) + 1}))
            .toEqual({data: 3, storedVersion: 1});
        expect(readVersioned([1], 0, {})).toEqual({data: [1], storedVersion: 0});
        expect(() => readVersioned({__carburetorVersion: -1, data: 1}, 2, {})).toThrow('invalid stored version');
        expect(() => readVersioned({__carburetorVersion: 3, data: 1}, 2, {})).toThrow('newer');
    });
});

describe('reportRemovalFailure', () => {
    test('calls the supplied handler or rethrows the original failure', () => {
        const error = new Error('remove failed');
        const handler = rstest.fn();
        reportRemovalFailure(handler, error);
        expect(handler).toHaveBeenCalledWith(error);
        expect(() => reportRemovalFailure(undefined, error)).toThrow(error);
    });
});

describe('reportRestoreFailure', () => {
    test('delegates errors or reports the failure in development', () => {
        const error = new Error('restore failed');
        const handler = rstest.fn();
        expect(reportRestoreFailure('key', error, handler, 'kept')).toBeUndefined();
        expect(handler).toHaveBeenCalledWith(error);
        const report = rstest.spyOn(diagnostics, 'report').mockImplementation(() => {});
        try {
            reportRestoreFailure('key', error, undefined, 'kept');
            if (IS_DEVELOPMENT) expect(report).toHaveBeenCalledWith(expect.stringContaining('restore failed'));
            else expect(report).not.toHaveBeenCalled();
        } finally {
            report.mockRestore();
        }
    });
});
