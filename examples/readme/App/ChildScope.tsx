import React from 'react';
import {CarburetorChildScope, CarburetorScope, carburetorToken} from 'react-carburetor';

const serviceToken = carburetorToken(() => ({name: 'shared'}), 'example/shared');
const panelToken = carburetorToken(owner => ({service: owner.get(serviceToken)}), 'example/panel');

export function createPanel(): {scope: CarburetorScope; dispose: () => void} {
    const root = new CarburetorScope();
    const scope = root.child([panelToken]);
    scope.get(panelToken);
    return {scope, dispose: (): void => root.dispose()};
}

/** A screen whose panel lives in a child scope and is disposed when the screen unmounts.
 *
 * @param props - the screen content
 * @param props.children - rendered inside the child scope
 */
export function Screen({children}: {children: React.ReactNode}): React.ReactElement {
    return <CarburetorChildScope tokens={[panelToken]}>{children}</CarburetorChildScope>;
}
