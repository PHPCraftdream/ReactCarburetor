import * as React from "react";
import {CarburetorContext, CarburetorScope, TReadonly} from "@/Carburetor";
import {useCarburetorValue, useComputedValue} from "@/Interop";
import {ITodoList} from "@/ToDo/API/Models";
import {todoToken} from "@/ToDo/Scope/Tokens/todoToken";
import {viewsToken} from "@/ToDo/Scope/Tokens/viewsToken";

/**
 * How many todos exist.
 *
 * @param data - the tracked list; only `orderIds.length` is read
 */
const selectTotal = (data: TReadonly<ITodoList>): number => data.orderIds.length;

/**
 * A function component, for the boundary with hooks-based code: the interop hooks give it the
 * same path precision as the class API, through useSyncExternalStore.
 */
export const ProgressBadge = (): React.ReactElement => {
    const scope = React.useContext(CarburetorContext) as CarburetorScope;
    const summary = useComputedValue(scope.get(viewsToken).summary);
    const total = useCarburetorValue(scope.get(todoToken), selectTotal);

    return (
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400" data-testid="progress-badge">
            {summary} of {total}
        </span>
    );
};
