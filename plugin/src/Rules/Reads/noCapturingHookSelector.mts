import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

export const noCapturingHookSelector: IRule = nativeRule(
    'carburetor/no-capturing-hook-selector',
    'Avoid inline hook selectors that capture render state.'
);
