import {AntiHookComponent, bind, ResourceCarburetor} from '@react-carburetor/core';
import {type JSX} from 'react';

interface User {
    id: string;
    name: string;
}

declare function fetchUser(id: string, init?: {signal?: AbortSignal}): Promise<User>;

// TArgs is a tuple, `[string]` here. A first `unknown`/`any` parameter would be
// taken for the signal; that edge needs the explicit `new ResourceCarburetor<T, [unknown]>(...)`.
const user = new ResourceCarburetor<User, [string]>(
    (id: string, signal) => fetchUser(id, {signal})
);

export class UserSwitcher extends AntiHookComponent<{initialId: string}> {
    // Click-to-switch: one store, one call per click. A load for the key of the
    // stored answer skips the request; a new key supersedes the active one.
    @bind
    private open(id: string): void {
        void user.load(id);
    }

    @bind
    private openNext(): void {
        void user.load('a2');
    }

    @bind
    private retry(): void {
        void user.refresh(this.props.initialId);
    }

    render(): JSX.Element {
        const view = this.useCarburetor(user);

        if (view.isPending) {
            return <span className="spinner">Loading…</span>;
        }
        if (view.isError) {
            return (
                <button type="button" onClick={this.retry}>
                    Retry
                </button>
            );
        }
        return (
            <span>
                <strong>{view.data?.name}</strong>
                <button type="button" onClick={this.openNext}>Switch user</button>
            </span>
        );
    }
}
