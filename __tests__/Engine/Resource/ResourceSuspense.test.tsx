import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, EResourceStatus, ResourceCarburetor} from "@/Carburetor";

interface IDeferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
}

const deferred = <T extends unknown>(): IDeferred<T> => {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;

    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return {promise, resolve, reject};
};

interface IViewProps {
    resource: ResourceCarburetor<string>;
}

class SuspendingView extends AntiHookComponent<IViewProps> {
    render() {
        // Subscribes to the resource, so a later reload re-renders this component too.
        this.useCarburetor(this.props.resource);

        return <div className="value">{this.props.resource.suspend(undefined)}</div>;
    }
}

interface IBoundaryState {
    message: string | undefined;
}

class Boundary extends React.Component<{children?: React.ReactNode}, IBoundaryState> {
    state: IBoundaryState = {message: undefined};

    static getDerivedStateFromError(error: unknown): IBoundaryState {
        return {message: error instanceof Error ? error.message : String(error)};
    }

    render() {
        if (this.state.message !== undefined) {
            return <div className="failed">{this.state.message}</div>;
        }

        return this.props.children;
    }
}

describe('resource under Suspense', () => {
    test('a class component suspends while the request is in flight', async () => {
        const gate = deferred<string>();
        const resource = new ResourceCarburetor<string>(() => gate.promise);

        const {container, unmount} = render(
            <React.Suspense fallback={<div className="fallback">loading</div>}>
                <SuspendingView resource={resource}/>
            </React.Suspense>
        );

        expect(container.querySelector('.fallback')).not.toBeNull();
        expect(resource.getData().status).toEqual(EResourceStatus.Pending);

        await act(async () => {
            gate.resolve('loaded');
            await gate.promise;
        });

        expect(container.querySelector('.value')?.textContent).toEqual('loaded');
        expect(container.querySelector('.fallback')).toBeNull();
        expect(resource.getData().status).toEqual(EResourceStatus.Success);

        unmount();
    });

    test('a failure reaches the error boundary', async () => {
        // React 19 logs the error this boundary catches; captured so the guard sees
        // only unexpected output.
        const original = console.error;
        const reported: string[] = [];

        console.error = (...args: unknown[]) => reported.push(args.map(String).join(' '));

        try {
            const gate = deferred<string>();
            const resource = new ResourceCarburetor<string>(() => gate.promise);

            const {container, unmount} = render(
                <Boundary>
                    <React.Suspense fallback={<div className="fallback">loading</div>}>
                        <SuspendingView resource={resource}/>
                    </React.Suspense>
                </Boundary>
            );

            expect(container.querySelector('.fallback')).not.toBeNull();

            await act(async () => {
                gate.reject(new Error('request failed'));
                await gate.promise.catch(() => undefined);
            });

            expect(container.querySelector('.failed')?.textContent).toEqual('request failed');

            unmount();
        } finally {
            console.error = original;
        }

        expect(reported.filter((message: string) =>
            message.includes('The above error occurred in the <SuspendingView> component')).length).toEqual(1);
    });
});
