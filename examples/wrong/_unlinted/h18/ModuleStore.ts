import {Carburetor} from 'react-carburetor';

declare function getInitialData(): {count: number};

class TodoCarburetor extends Carburetor<{count: number}> {}

// #region doc
export const todoCarburetor = new TodoCarburetor(getInitialData());
// #endregion doc
