import {CarburetorScope, carburetorToken} from 'react-carburetor';

const serviceToken = carburetorToken(() => ({name: 'shared'}), 'example/shared');
const panelToken = carburetorToken(owner => ({service: owner.get(serviceToken)}), 'example/panel');

export function createPanel(): {scope: CarburetorScope; dispose: () => void} {
    const root = new CarburetorScope();
    const scope = root.child([panelToken]);
    scope.get(panelToken);
    return {scope, dispose: (): void => root.dispose()};
}
