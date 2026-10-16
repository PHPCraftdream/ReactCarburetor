import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

export const noMemoOverStoreRead: IRule = nativeRule(
    'carburetor/no-memo-over-store-read',
    'Derive values in the store selector instead of memoizing a store-hook read.'
);
