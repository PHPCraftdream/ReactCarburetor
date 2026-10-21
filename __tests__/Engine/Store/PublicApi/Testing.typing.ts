import type {Carburetor, CarburetorScope} from '@/Carburetor';
import type {ICarburetorToken} from '@/Carburetor/Models/Tooling';
import {createTestScope, flush} from '@/Testing';

declare const store: Carburetor<{count: number}>;
declare const scope: CarburetorScope;
declare const token: ICarburetorToken<{count: number}>;

flush(store);
flush(scope);
const testScope = createTestScope([[token, {count: 3}]]);
testScope.get(token).count satisfies number;
testScope.dispose();

// @ts-expect-error flush accepts only carburetors and scopes
flush({});
const otherToken = null as unknown as ICarburetorToken<{name: string}>;
createTestScope([[token, {count: 3}], [otherToken, {name: 'test'}]]);
