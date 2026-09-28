import { UpdateWave } from "./UpdateWave.js";
/**
 * The wave every notification pass runs inside, so one write settles before it is announced.
 * Shared across every copy of the library in this process — see sharedSingleton — so a computed
 * deferred by one copy is still drained by whichever copy's wave actually settled the write.
 */
export declare const updateWave: UpdateWave;
