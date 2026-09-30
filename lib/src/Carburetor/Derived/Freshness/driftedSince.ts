import {IDict} from '@/Carburetor/Models/Base';
import {ILeafVersion} from './Models';

/** Compares announcement leaf baselines.
 *
 * @param record - the previous announcement snapshot
 * @param current - the current evaluation snapshot
 */
export const driftedSince = (record: IDict<ILeafVersion>, current: IDict<ILeafVersion>): boolean => {
    for (const cuid of Object.keys(record)) {
        const recorded = record[cuid];

        if (recorded.source.getVersion() !== recorded.version) {
            return true;
        }
    }

    for (const cuid of Object.keys(current)) {
        if (!Object.prototype.hasOwnProperty.call(record, cuid)) {
            return true;
        }
    }

    return false;
};
