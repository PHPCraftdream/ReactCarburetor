import {computed} from '@react-carburetor/core';
import {activeCount} from './ActiveCount';

// #region summary
export const summary = computed<string>((read) => `${read(activeCount)} left`);
// #endregion summary
