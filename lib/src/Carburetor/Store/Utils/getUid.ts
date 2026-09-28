import {sharedSingleton} from "@/Carburetor/Store/Utils/sharedSingleton";

interface IUidCounter {
    next: number;
}

/**
 * Shared across library copies (see sharedSingleton): colliding uids would overwrite wave and
 * subscription entries.
 */
const counter: IUidCounter = sharedSingleton('uidCounter', (): IUidCounter => ({next: 0}));

/** Mints a process-wide unique id in the `carburetor-uid-N` format. */
export const getUid = (): string => {
    counter.next++;

    return 'carburetor-uid-' + counter.next;
};
