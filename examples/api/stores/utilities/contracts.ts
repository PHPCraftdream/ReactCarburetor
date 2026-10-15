// #region typing
import {
    Carburetor,
    ICarburetor,
    IReadableCarburetor,
    IPatchSource, // unstable, do not implement: internal engine protocol, no stability guarantee
} from 'react-carburetor';

interface IState {value: number}

const ignorePath = (_path: string): void => {};

/** Read-only consumers (trackers, telemetry) accept the narrow interface. */
function observe(source: IReadableCarburetor<IState>): void {
    source.read(ignorePath);
}

/** History tooling additionally needs the unstable patch surface. */
function attachHistory(source: ICarburetor<IState> & IPatchSource): void {
    void source;
}

const store = new Carburetor<IState>({value: 0});
observe(store);
attachHistory(store);
// #endregion typing
