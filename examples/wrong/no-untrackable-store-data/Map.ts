import {Carburetor} from 'react-carburetor';

// #region doc
export interface IData {
    index: Map<string, number>;
}
// #endregion doc

class Todos extends Carburetor<IData> {}

void Todos;
