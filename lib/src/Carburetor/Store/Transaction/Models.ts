import {
    IStateInstallation, IStatePublication, IStateRestoreClaim,
    TAliasLedger, TPath, TPathSet, TPatchPort,
} from '@/Carburetor/Models/Paths';
import {WriteLog} from '@/Carburetor/Store/Paths/WriteLog';
import {WriteTargetLedger} from '@/Carburetor/Store/Utils/Graph/WriteTargetLedger';
import {CARBURETOR_NOTIFY_WRITES} from '@/Carburetor/Store/Utils/Models';

/** Store boundary consumed by the shared mutation commit implementation. */
export interface IStorePublicationPort<T extends object> {
    data: T;
    draftTouched: boolean;
    writes: TPathSet;
    writeTargets: WriteTargetLedger;
    writeLog: WriteLog;
    version: number;
    publicationPending: boolean;
    pendingPublication: IStatePublication | undefined;
    patchPort: TPatchPort;
    preEmit(): void;
    rememberPublication(installation?: IStateInstallation): void;
    [CARBURETOR_NOTIFY_WRITES](writes: TPathSet): void;
}

/** Core fields and boundaries required to install a root without duplicating store orchestration. */
export interface IStateInstallPort<T extends object> extends IStorePublicationPort<T> {
    aliases: TAliasLedger;
    draftProxy: T | undefined;
    patchObservers: {
        claimRestore(state: unknown): IStateRestoreClaim | undefined;
        markPendingInstall(): void;
    } | undefined;
    didSetData(): void;
    touchDraft(): void;
    recordWrite(path: TPath): void;
    emitSoon(installation?: IStateInstallation, deferredContinuation?: boolean): void;
    emitUpdate(installation?: IStateInstallation, deferredContinuation?: boolean): void;
}
