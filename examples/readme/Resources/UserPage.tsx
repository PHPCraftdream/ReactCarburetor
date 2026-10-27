// #region userPage
import React, {Suspense} from 'react';
import {
    AntiHookComponent,
    ResourceCache,
    bind,
} from '@react-carburetor/core';

interface User {
    id: string;
    name: string;
}

const users = new ResourceCache<User, [string]>(async (id, signal) => {
    const response = await fetch(`/api/users/${id}`, {signal});
    if (!response.ok) throw new Error(`User request failed: ${response.status}`);
    return response.json() as Promise<User>;
}, {ttl: 30_000, maxEntries: 200});

export class UserBadge extends AntiHookComponent<{id: string}> {
    @bind
    private retry(): void {
        void users.refresh(this.props.id);
    }

    public render() {
        const user = this.useResource(users, this.props.id);
        if (user.isIdle || user.isPending) {
            return <span>Loading…</span>;
        }
        if (user.isError) {
            return (
                <span role="alert">
                    {user.error}{' '}
                    <button onClick={this.retry}>Retry</button>
                </span>
            );
        }
        return (
            <span>
                {user.data?.name}
                {user.refreshing ? ' (refreshing)' : ''}
                {user.error ? <button onClick={this.retry}>Retry</button> : null}
            </span>
        );
    }
}

class SuspendingUser extends AntiHookComponent<{id: string}> {
    public render() {
        const {data} = this.useResource(users, this.props.id);
        users.suspend(this.props.id);
        return <span>{data?.name}</span>;
    }
}

class UserBoundary extends React.Component<
    {children?: React.ReactNode},
    {message: string | undefined}
> {
    state = {message: undefined as string | undefined};

    static getDerivedStateFromError(error: unknown) {
        return {message: error instanceof Error ? error.message : String(error)};
    }

    @bind
    private retry(): void {
        users.invalidate('a1');
        this.setState({message: undefined});
    }

    render() {
        if (this.state.message !== undefined) {
            return (
                <div role="alert">
                    {this.state.message}
                    <button onClick={this.retry}>Retry</button>
                </div>
            );
        }
        return this.props.children;
    }
}

export const UserPage = () => (
    <UserBoundary>
        <Suspense fallback={<span>Loading…</span>}>
            <SuspendingUser id="a1" />
        </Suspense>
    </UserBoundary>
);
// #endregion userPage
