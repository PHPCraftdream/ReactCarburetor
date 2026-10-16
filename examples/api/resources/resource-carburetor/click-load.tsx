import {AntiHookComponent, ResourceCarburetor} from 'react-carburetor';
import {type JSX} from 'react';

interface Config {
    theme: string;
}

declare function fetchConfig(): Promise<Config>;

// A resource without parameters: TArgs is the empty tuple, and the bound handles
// drop an incoming DOM/React event argument before the loader sees it, so the
// handle itself can sit in `onClick`.
const config = new ResourceCarburetor<Config, []>(
    (signal: AbortSignal) => fetchConfig().then((value: Config) => {
        if (signal.aborted) {
            throw new Error('aborted');
        }
        return value;
    })
);

export class ConfigBadge extends AntiHookComponent {
    render(): JSX.Element {
        const view = this.useCarburetor(config);

        if (view.isIdle) {
            return <button type="button" onClick={config.load}>Load</button>;
        }
        if (view.isPending) {
            return <span className="spinner">Loading…</span>;
        }
        if (view.isError) {
            // refresh is bound the same way: the event it receives is dropped.
            return <button type="button" onClick={config.refresh}>Retry</button>;
        }
        return <span className="theme">{view.data?.theme}</span>;
    }
}
