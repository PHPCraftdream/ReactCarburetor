// #region suspense
import {AntiHookComponent, ResourceCache} from '@react-carburetor/core';
import {Component, ReactNode, Suspense, type JSX} from 'react';

interface Avatar {
    url: string;
}

declare function fetchAvatar(userId: string): Promise<Avatar>;

const avatarCache = new ResourceCache<Avatar, [string]>((userId: string) => fetchAvatar(userId));

class AvatarBoundary extends Component<{children?: ReactNode}, {error: unknown}> {
    public state = {error: undefined as unknown};

    public static getDerivedStateFromError(error: unknown): {error: unknown} {
        return {error};
    }

    render(): JSX.Element {
        if (this.state.error !== undefined) {
            return <span className="error">Avatar failed to load</span>;
        }
        return <>{this.props.children}</>;
    }
}

export class AvatarImage extends AntiHookComponent<{userId: string}> {
    render(): JSX.Element {
        const view = this.useResource(avatarCache, this.props.userId);
        const avatar: Avatar = view.data ?? avatarCache.suspend(this.props.userId);
        return <img className="avatar" src={avatar.url} alt="" />;
    }
}

export class AvatarWithFallback extends AntiHookComponent<{userId: string}> {
    render(): JSX.Element {
        return (
            <AvatarBoundary>
                <Suspense fallback={<span className="spinner">…</span>}>
                    <AvatarImage userId={this.props.userId} />
                </Suspense>
            </AvatarBoundary>
        );
    }
}

export const isAvatarError = (view: {isError: boolean}): boolean =>
    view.isError;
// #endregion suspense

void AvatarWithFallback;
void isAvatarError;
