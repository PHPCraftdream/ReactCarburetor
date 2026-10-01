import {TPathSet} from "@/Carburetor/Models/Paths";
import {TCompletedObservation} from "./Models";

/** Closes an existing value/read pair without another wrapper allocation.
 *
 * @param observation - value and reads after comparison and detachment.
 */
export const completeObservation = <T extends {value: unknown; reads: TPathSet}>(
    observation: T
): TCompletedObservation<T> => observation as unknown as TCompletedObservation<T>;
