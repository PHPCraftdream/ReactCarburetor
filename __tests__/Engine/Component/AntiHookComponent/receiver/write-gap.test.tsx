import * as React from 'react';
import {createRoot} from 'react-dom/client';
import * as api from '@/Carburetor';
import {checkWriteGap} from '../../../../../perf/scenarios/components42/checks.mjs';

import {enableReactActEnvironment} from '../../../../reactActEnvironment';

enableReactActEnvironment();

test('R42-A01 child layout write between render and owner commit is delivered', async () => {
    await checkWriteGap({React, createRoot, api});
});
