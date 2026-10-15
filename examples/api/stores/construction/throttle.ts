// #region throttle
import {Carburetor, ComponentUpdateThrottle} from 'react-carburetor';

interface ICursor {x: number; y: number}

// At most one notification per subscriber per 40 ms, no matter how many writes land.
const throttle = new ComponentUpdateThrottle(40);
const cursorStore = new Carburetor<ICursor>({x: 0, y: 0}, throttle);

cursorStore.setData({x: 1, y: 1});
cursorStore.setData({x: 2, y: 2}); // coalesced into one flush with the write above
// #endregion throttle
