import { IDict } from '../../Models/Base.js';
import { ILeafVersion } from './Models.js';
/** Compares announcement leaf baselines.
 *
 * @param record - the previous announcement snapshot
 * @param current - the current evaluation snapshot
 */
export declare const driftedSince: (record: IDict<ILeafVersion>, current: IDict<ILeafVersion>) => boolean;
