import {memo} from 'react';
declare const Child: any;
/** Builds a memoized row component capturing onSelect per H21 capture advice. */
export function makeRow(onSelect: () => void) {
    return memo(function Row() {
        return <Child onSelect={() => onSelect()} />;
    });
}
