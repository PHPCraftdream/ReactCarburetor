import {createTestScope, flush} from '../../../../../../dist/esm/Testing/index.mjs';
import {Carburetor} from '../../../../../../dist/esm/Carburetor/index.mjs';

const scope = createTestScope();
flush(scope);
flush(new Carburetor({n: 0}));
void scope;
