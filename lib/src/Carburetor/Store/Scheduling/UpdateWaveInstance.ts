import {UpdateWave} from "./UpdateWave";

/** The wave every notification pass runs inside, so one write settles before it is announced. */
export const updateWave = new UpdateWave();
