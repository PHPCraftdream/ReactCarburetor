import { IDict } from '../../Models/Base.mjs';
import { ILeafVersion } from './Models.mjs';
/** Compares announcement leaf baselines.
 *
 * @param record - the previous announcement snapshot
 * @param current - the current evaluation snapshot
 */
export declare const driftedSince: (record: IDict<ILeafVersion>, current: IDict<ILeafVersion>) => boolean;
