import {AntiHookComponent, ResourceCarburetor, resourceState} from '@react-carburetor/core';
import {type JSX} from 'react';

interface Config {
    theme: string;
}

declare function fetchConfig(init?: {signal?: AbortSignal}): Promise<Config>;

// A resource without parameters: TArgs is the empty tuple, and the bound handles
// drop an incoming DOM/React event argument before the loader sees it, so the
// handle itself can sit in `onClick`.
const config = new ResourceCarburetor<Config, []>(
    (signal) => fetchConfig({signal})
);

export class ConfigBadge extends AntiHookComponent {
    render(): JSX.Element {
        const view = this.useCarburetor(config);

        // resourceState derives the flag view from the raw state fields: loading before the
        // first answer lands, refreshFailed after a failed refresh.
        const state = resourceState(view.status, view.data, view.error);

        if (state.isIdle) {
            return <button type="button" onClick={config.load}>Load</button>;
        }
        if (state.isPending) {
            return <span className="spinner">Loading…</span>;
        }
        if (state.isError) {
            // refresh is bound the same way: the event it receives is dropped.
            return <button type="button" onClick={config.refresh}>Retry</button>;
        }
        return <span className="theme">{view.data?.theme}</span>;
    }
}
