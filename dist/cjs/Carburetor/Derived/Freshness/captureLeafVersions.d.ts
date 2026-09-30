import { IDict } from '../../Models/Base.js';
import { ILeafVersion, IReadSet } from './Models.js';
/** Fills a version snapshot and classifies native epoch coverage.
 *
 * @param dependencies - direct read sets to flatten
 * @param versions - destination leaf snapshot
 */
export declare const captureLeafVersions: (dependencies: IDict<IReadSet>, versions: IDict<ILeafVersion>) => boolean;
