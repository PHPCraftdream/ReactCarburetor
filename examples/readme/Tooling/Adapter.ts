import {Carburetor, Diagnostics, diagnostics, getInitialResourceData} from '@react-carburetor/core';
interface User {name: string}
const adapterState = new Carburetor(getInitialResourceData<User>());
const localDiagnostics = new Diagnostics();
localDiagnostics.setEnabled(true);
localDiagnostics.report(`Adapter starts in ${adapterState.getData().status}`);
const wasEnabled = diagnostics.isEnabled();
try {
    diagnostics.setEnabled(false);
} finally {
    diagnostics.setEnabled(wasEnabled);
}