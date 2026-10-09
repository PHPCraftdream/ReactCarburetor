import {
    IStateInstallation, IStatePublication, IStateRestoreClaim,
    TAliasLedger, TPath, TPathSet, TPatchPort,
} from '@/Carburetor/Models/Paths';
import {WriteLog} from '@/Carburetor/Store/Paths/WriteLog';
import {WriteTargetLedger} from '@/Carburetor/Store/Utils/Graph/WriteTargetLedger';
import {CARBURETOR_NOTIFY_WRITES} from '@/Carburetor/Store/Utils/Models';

import {S} from "@/Carburetor/Store/Diagnostics/Internal/StoreIdentity";

/** Store boundary consumed by the shared mutation commit implementation. */
export interface IStorePublicationPort<T extends object> {
    [S.data]: T;
    [S.draftTouched]: boolean;
    [S.writes]: TPathSet;
    [S.writeTargets]: WriteTargetLedger;
    [S.writeLog]: WriteLog;
    [S.version]: number;
    [S.publicationPending]: boolean;
    [S.pendingPublication]: IStatePublication | undefined;
    [S.patchPort]: TPatchPort;
    preEmit(changed: ReadonlySet<string>): void;
    [S.rememberPublication](installation?: IStateInstallation): void;
    [CARBURETOR_NOTIFY_WRITES](writes: TPathSet): void;
}

/** Core fields and boundaries required to install a root without duplicating store orchestration. */
export interface IStateInstallPort<T extends object> extends IStorePublicationPort<T> {
    [S.aliases]: TAliasLedger;
    [S.draftProxy]: T | undefined;
    [S.patchObservers]: {
        claimRestore(state: unknown): IStateRestoreClaim | undefined;
        markPendingInstall(): void;
    } | undefined;
    didSetData(): void;
    [S.touchDraft](): void;
    [S.recordWrite](path: TPath): void;
    emitSoon(installation?: IStateInstallation, deferredContinuation?: boolean): void;
    emitUpdate(installation?: IStateInstallation, deferredContinuation?: boolean): void;
}
