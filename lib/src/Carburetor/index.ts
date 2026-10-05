// The public surface of the package. Internals — the tracking proxies, the proxy cache,
// path string plumbing and the batch coordinator — are deliberately absent: they are
// implementation details, and exporting them would put them under the semver contract.

export * from './Models/Base';
export * from './Models/Derived';
export * from './Models/Enums/EDevToolsAction';
export * from './Models/Enums/EDevToolsMessageType';
export * from './Models/Enums/EResourceStatus';
// TAliasLedger is deliberately not re-exported here (R16-10): it is the shape of a
// development-only ledger, not part of the package's public contract. TPath/TPathSet/
// TPathRecorder join it for the same reason (R16-10(1)): the path grammar they describe is an
// engine internal that has already changed shape once (R16-01) — subscribe(callback, {reads})
// and read(record) are the documented extension contract, typed with plain string/ReadonlySet
// so a caller never needs to name these aliases.
export * from './Models/Resource';
export * from './Models/Store';
export * from './Models/Tooling';

export * from './Store/Carburetor';
export * from './Store/Diagnostics/Diagnostics';
export * from './Store/Diagnostics/DiagnosticsInstance';
// WILDCARD_PATH is deliberately not re-exported here (R16-10(1)): it is one concrete path
// string, the engine's own "every write" marker — a caller reaches the same effect by omitting
// `reads` from subscribe()/watch(), never by naming this constant.
export * from './Store/Scheduling/ComponentUpdateThrottle';
export * from './Store/Transaction/transaction';
export * from './Store/Utils/deepClone';

export * from './Derived/Computed';
export * from './Derived/computedFactory';

export * from './Resource/getInitialResourceData';
export * from './Resource/ResourceCarburetor';
export * from './Resource/Cache/ResourceCache';

export * from './Component/AntiHookComponent/index';
export * from './Component/bind';
export * from './Component/Scope/CarburetorContext';
export * from './Component/Scope/CarburetorProvider';
export * from './Component/Scope/CarburetorScope';
export * from './Component/Scope/carburetorToken';
export * from './Component/ScopedAntiHookComponent';
export * from './Component/shallowEqual';

export * from './Tooling/CarburetorHistory';
export * from './Tooling/connectDevTools';
export * from './Tooling/persist';
export * from './Tooling/waitForUpdate';
