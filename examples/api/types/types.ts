import {TEffect, TEffectCleanup, TEffectDeps, TDisposer, TReadonly, TSubscriber, TTimerHandle} from 'react-carburetor';

const disposer: TDisposer = () => undefined;
const subscriber: TSubscriber = () => disposer();
const cleanup: TEffectCleanup = () => clearTimeout(handle);
const effect: TEffect = () => cleanup;
const deps: TEffectDeps = [1, 'stable'];
const immutable: TReadonly<{value: number}> = {value: 1};
const handle: TTimerHandle = setTimeout(subscriber, 1);
void [effect, deps, immutable];
