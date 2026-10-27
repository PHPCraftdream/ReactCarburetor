// #region list
import {AntiHookComponent, bind, ResourceCache} from '@react-carburetor/core';
import {type JSX} from 'react';
import {fetchPost} from '../endpoints/posts';

interface Post {
    id: string;
    title: string;
}

export const postCache = new ResourceCache<Post, [string]>((id: string, _signal: AbortSignal) => fetchPost(id));

const renderPost = (id: string): JSX.Element => <PostListItem key={id} postId={id} />;

export class PostList extends AntiHookComponent<{postIds: string[]}> {
    render(): JSX.Element {
        return <ul>{this.props.postIds.map(renderPost)}</ul>;
    }
}

class PostListItem extends AntiHookComponent<{postId: string}> {
    @bind
    private refresh(): void {
        void postCache.refresh(this.props.postId);
    }

    render(): JSX.Element {
        const view = this.useResource(postCache, this.props.postId);
        return (
            <li className={view.stale ? 'stale' : undefined}>
                <button type="button" onClick={this.refresh}>↻</button>
                <PostRow postId={this.props.postId} />
            </li>
        );
    }
}

class PostRow extends AntiHookComponent<{postId: string}> {
    render(): JSX.Element {
        const view = this.useResource(postCache, this.props.postId);
        if (view.isSuccess && view.data !== undefined) {
            return <span className="title">{view.data.title}</span>;
        }
        return <span className="status">{view.status}</span>;
    }
}
// #endregion list
