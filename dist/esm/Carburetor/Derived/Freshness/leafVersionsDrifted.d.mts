import { IDict } from '../../Models/Base.mjs';
import { ILeafVersion, IReadSet } from './Models.mjs';
/** Checks leaf drift without allocating a key array.
 *
 * @param versions - the evaluation's leaf snapshot
 * @param dependencies - fallback direct read sets
 */
export declare const leafVersionsDrifted: (versions: IDict<ILeafVersion>, dependencies: IDict<IReadSet>) => boolean;
