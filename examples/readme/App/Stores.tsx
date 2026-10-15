/* The directive below is a bundler annotation; oxlint sees it as an unused expression outside a module prologue. */
/* oxlint-disable no-unused-expressions */
import React from 'react';
import {CarburetorProvider, CarburetorScope} from 'react-carburetor';
// #region doc
'use client';

const createScope = (): CarburetorScope => new CarburetorScope();

export function Stores({children}: {children: React.ReactNode}) {
    const [scope] = React.useState(createScope);

    return <CarburetorProvider scope={scope}>{children}</CarburetorProvider>;
}
// #endregion doc
