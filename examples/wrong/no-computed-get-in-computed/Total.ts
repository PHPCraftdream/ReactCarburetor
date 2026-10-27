import {Carburetor, computed} from '@react-carburetor/core';

const store = new Carburetor({visible: 2});
const visibleCount = computed(read => read(store).visible);

// #region doc
export const total = computed(() => visibleCount.get() * 2);
// #endregion doc
