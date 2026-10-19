import {IDict} from '@/Carburetor/Models/Base';
import {ILeafVersion} from '@/Carburetor/Derived/Freshness/Models';
import {sharedSingleton} from '@/Carburetor/Store/Utils/sharedSingleton';

const growth = sharedSingleton('computedLeafReadGrowth', () => ({value: 0}));
const watermarks = sharedSingleton('computedLeafWatermarks', () =>
    new WeakMap<IDict<ILeafVersion>, {growth: number; at: Map<string, number>}>());

/** Tracks whether a leaf's recorded read watermark is still proven. */
export const leafWatermarks = {
    /** Tests whether a leaf's current version watermark is still proven.
     *
     * @param versions - The captured leaf-version dictionary.
     * @param cuid - The encoded leaf identity.
     * @param currentVersion - The leaf's current version to check.
     */
    proven(versions: IDict<ILeafVersion>, cuid: string, currentVersion: number): boolean {
        const entry = watermarks.get(versions);
        return !!entry && entry.growth === growth.value && entry.at.get(cuid) === currentVersion;
    },
    /** Files proof of a leaf's current version at the current read-growth generation.
     *
     * @param versions - The captured leaf-version dictionary.
     * @param cuid - The encoded leaf identity.
     * @param currentVersion - The leaf's current version to file.
     */
    prove(versions: IDict<ILeafVersion>, cuid: string, currentVersion: number): void {
        let entry = watermarks.get(versions);
        if (!entry || entry.growth !== growth.value) {
            entry = {growth: growth.value, at: new Map()};
            watermarks.set(versions, entry);
        }
        entry.at.set(cuid, currentVersion);
    },
    /** Invalidates every filed proof after a computed read grows.
     */
    grow(): void {
        growth.value++;
    },
};
