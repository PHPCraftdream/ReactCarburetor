import {Carburetor, computed} from 'react-carburetor';

const store = new Carburetor({visible: 2});
const visibleCount = computed(read => read(store).visible);

// #region doc
export const total = computed(read => read(visibleCount) * 2);
// #endregion doc
