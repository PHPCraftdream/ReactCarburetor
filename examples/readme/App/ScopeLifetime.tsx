import React from 'react';
import {CarburetorProvider, CarburetorScope, carburetorToken, Carburetor} from 'react-carburetor';

class ClockStore extends Carburetor<{ticks: number}> {
    public constructor() { super({ticks: 0}); }

    public start(): void {
        this.after(1000, () => this.update(draft => { draft.ticks += 1; }));
    }
}

interface IScreenLifetime {
    element: React.ReactNode;
    dispose: () => void;
}

const clockToken = carburetorToken(() => new ClockStore(), 'screen/clock');
const gameToken = carburetorToken(owner => ({clock: owner.get(clockToken)}), 'screen/game');

/** Creates a screen scope and returns its provider element and owner-controlled disposer.
 *
 * @param children - the screen content to provide the scope to
 */
export function createScreen(children: React.ReactNode): IScreenLifetime {
    const scope = new CarburetorScope();
    scope.get(gameToken).clock.start();
    return {
        element: <CarburetorProvider scope={scope}>{children}</CarburetorProvider>,
        dispose: (): void => scope.dispose(),
    };
}
