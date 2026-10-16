import {useCallback} from 'react';
declare const Child: any; declare const select: (id: string) => void;
/** Row probes the handler capture pattern asserted by h31 diagnostics. */
export function Row({id}: {id: string}) {
    const handler = () => select(id);
    // oxlint-disable-next-line react/use-memo
    return <Child onSelect={useCallback(handler, [id])} />;
}
