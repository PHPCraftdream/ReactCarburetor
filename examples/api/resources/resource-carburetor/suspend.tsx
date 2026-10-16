// #region suspend
import {AntiHookComponent, IResourceCarburetorOptions, IResourceData, ResourceCarburetor} from 'react-carburetor';
import {Component, ReactNode, Suspense, type JSX} from 'react';
import {fetchConfig} from '../endpoints/config';

interface Config {
    theme: string;
}

const options: IResourceCarburetorOptions = {ttl: 30_000};

export const configResource = new ResourceCarburetor<Config>(
    (_signal: AbortSignal) => fetchConfig(),
    options
);

class ConfigErrorBoundary extends Component<{children?: ReactNode}, {error: string | undefined}> {
    public state = {error: undefined as string | undefined};

    public static getDerivedStateFromError(error: unknown): {error: string} {
        return {error: error instanceof Error ? error.message : String(error)};
    }

    render(): JSX.Element {
        if (this.state.error !== undefined) {
            return <span className="error">Config failed: {this.state.error}</span>;
        }
        return <>{this.props.children}</>;
    }
}

export class ConfigView extends AntiHookComponent {
    render(): JSX.Element {
        const view = this.useCarburetor(configResource);
        const value: Config = configResource.suspend();
        return <span className={view.isPending ? 'theme refreshing' : 'theme'}>{value.theme}</span>;
    }
}

export class ConfigShell extends AntiHookComponent {
    render(): JSX.Element {
        return (
            <ConfigErrorBoundary>
                <Suspense fallback={<span className="spinner">Loading…</span>}>
                    <ConfigView />
                </Suspense>
            </ConfigErrorBoundary>
        );
    }
}

export const describeResourceState = (view: IResourceData<Config>): string =>
    view.isSuccess ? view.data?.theme ?? '' : '';
// #endregion suspend
