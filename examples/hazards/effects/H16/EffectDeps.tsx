import {AntiHookComponent} from '@react-carburetor/core';

declare function connect(url: string): () => void;

export class GoodDeps extends AntiHookComponent<{url: string}> {
    protected useEffects(): void {
        // #region doc
        this.useEffect('connect', () => connect(this.props.url), [this.props.url]);
        // #endregion doc
    }

    public render() {
        return null;
    }
}
