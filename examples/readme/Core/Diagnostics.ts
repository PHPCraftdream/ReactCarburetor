import {diagnostics} from '@react-carburetor/core';
import type {IUpdateTrace} from '@react-carburetor/core';

// #region diagnostics
diagnostics.setEnabled(false);   // silence them anywhere
diagnostics.isEnabled();
// #endregion diagnostics

// #region trace
/** Logs which subscriber woke and which written paths it had read. */
const logTrace = (trace: IUpdateTrace): void => {
    console.debug(trace.subscriber, trace.store, trace.paths);
};

const stopTrace = diagnostics.traceUpdates(logTrace);
stopTrace();
// #endregion trace
