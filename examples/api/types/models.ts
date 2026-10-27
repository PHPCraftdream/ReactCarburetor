import {
    Computed, CarburetorContext, CarburetorProvider, Diagnostics, EDevToolsAction, EDevToolsMessageType,
    EResourceStatus, ICarburetor, IComputed, IPatchSource, ScopedAntiHookComponent, TDisposer, TSelector, TUpdater,
    deepClone, diagnostics, getInitialResourceData, transaction,
} from '@react-carburetor/core';

const action: EDevToolsAction = EDevToolsAction.Rollback;
const message: EDevToolsMessageType = EDevToolsMessageType.Dispatch;
const status: EResourceStatus = EResourceStatus.Success;
const customDiagnostics = new Diagnostics();
customDiagnostics.setEnabled(false);
customDiagnostics.report('example');
diagnostics.isEnabled();
const copy = deepClone({value: 1});
const initialData = getInitialResourceData<number>();
const computed: IComputed<number> = new Computed(() => 1);
const updater: TUpdater = () => undefined;
const context = CarburetorContext;
const Provider = CarburetorProvider;
const scoped = ScopedAntiHookComponent;
const patchSource: IPatchSource | undefined = undefined;

declare const store: ICarburetor<{value: number}>;
declare const selector: TSelector<{value: number}, number>;
const dispose: TDisposer = () => undefined;
transaction(() => store.setData({value: selector(store.getData())}));
void [action, message, status, copy, initialData, computed, updater, context, Provider, scoped, patchSource, dispose];
