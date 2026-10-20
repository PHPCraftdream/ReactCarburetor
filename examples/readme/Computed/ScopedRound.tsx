import {computed, carburetorToken, ScopedAntiHookComponent} from 'react-carburetor';
import {RoundStore} from '../App/RoundStore';

// #region scoped-round-class
export class RoundViews extends RoundStore {
    // #region computed-field
    public readonly visible = computed((read) => {
        const {round} = read(this);
        return round.wrong.flatMap((wrong, index) => wrong === 0 ? [index] : []);
    });
    // #endregion computed-field
}
// #endregion scoped-round-class

// #region scoped-token
export const scopedRoundToken = carburetorToken<RoundViews>(
    () => new RoundViews({round: {kind: 'quiz', wrong: [0, 0], locked: false}}),
    'readme/scoped-round'
);
// #endregion scoped-token

export class RoundKindView extends ScopedAntiHookComponent<{onRender: () => void}> {
    public render() {
        this.props.onRender();
        // #region kind-read
        const store = this.resolve(scopedRoundToken);
        const {round} = this.useCarburetor(store);
        return <span className="kind">{round.kind}</span>;
        // #endregion kind-read
    }
}

export class ScopedVisibleRound extends ScopedAntiHookComponent {
    // #region computed-render
    public render() {
        const store = this.resolve(scopedRoundToken);
        return <span className="visible">{this.useComputed(store.visible).join(',')}</span>;
    }
    // #endregion computed-render
}
