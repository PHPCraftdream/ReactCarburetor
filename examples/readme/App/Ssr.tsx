import {renderToString} from 'react-dom/server';
import {hydrateRoot} from 'react-dom/client';
import {
    CarburetorProvider,
    CarburetorScope,
    ScopedAntiHookComponent,
    ResourceCache,
    carburetorToken,
} from 'react-carburetor';
const loadUser = async (id: string): Promise<{name: string}> => ({name: `User ${id}`});
const userToken = carburetorToken(
    () => new ResourceCache(loadUser, {ttl: 30_000}),
    'ssr-example-users',
);
class UserScreen extends ScopedAntiHookComponent {
    render() {
        const cache = this.resolve(userToken);
        const user = this.useResource(cache, 'a1');
        return <span>{user.data?.name ?? 'Loading…'}</span>;
    }
}
const tree = (scope: CarburetorScope) => <CarburetorProvider scope={scope}><UserScreen/></CarburetorProvider>;
export async function renderRequest() {
    const scope = new CarburetorScope();
    await scope.get(userToken).load('a1');
    const markup = renderToString(tree(scope));
    const payload = JSON.stringify(scope.dehydrate()).replace(/</g, '\\u003c');
    return {markup, payload};
}
export function hydratePage(container: HTMLElement, payload: string) {
    const scope = new CarburetorScope();
    scope.hydrate(JSON.parse(payload) as Record<string, unknown>);
    return hydrateRoot(container, tree(scope));
}