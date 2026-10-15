import {Carburetor} from 'react-carburetor';

declare function log(data: unknown): void;

const todoCarburetor = new Carburetor({count: 0});

export function demo(): void {
    // #region doc
    todoCarburetor.subscribe(() => log(todoCarburetor.getData()));
    // #endregion doc
}
