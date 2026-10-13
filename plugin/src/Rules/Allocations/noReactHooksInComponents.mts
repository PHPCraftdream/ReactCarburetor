import {nativeRule} from "#src/Utils/Native/nativeRule.mts";
import type {IRule} from "#src/Models.mts";

/** Enforces optional hook-free component ownership without promising zero allocations. */
export const noReactHooksInComponents: IRule = nativeRule(
    'carburetor/no-react-hooks-in-components',
    'Disallow React use-functions in hook-free components; instance ownership does not guarantee zero GC.'
);
