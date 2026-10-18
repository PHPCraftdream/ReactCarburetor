// #region scheduler-options
import {Carburetor, ICarburetorOptions, UpdateThrottle} from 'react-carburetor';

interface ICursor {x: number; y: number}

// The options-object form carries the same delivery policy as the positional
// argument, spelled as construction options.
const options: ICarburetorOptions = {scheduler: new UpdateThrottle(40)};
const cursorStore = new Carburetor<ICursor>({x: 0, y: 0}, options);

cursorStore.setData({x: 1, y: 1});
// #endregion scheduler-options
